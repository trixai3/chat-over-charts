import { describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { ClickHouseAdapter, compileClickHouseQuery } from "./clickhouse-adapter";
import { getSemanticModel, planAnalysis } from "./semantic-model";

function londonComparisonPlan() {
  const plan = planAnalysis({
    question: "Compare London boroughs by median price",
    sourceId: "uk-house-prices",
    analysisType: "category_comparison",
    measures: ["median price", "transactions"],
    dimensions: [{ field: "borough" }],
    filters: [{ field: "county", operator: "equals", value: "Greater London" }],
    orderBy: [{ field: "median price", direction: "desc" }],
  });
  if (plan.status !== "ready") throw new Error("Expected a ready plan");
  return plan;
}

describe("ClickHouse semantic compiler", () => {
  it("builds parameterized SQL only from governed expressions", () => {
    const plan = londonComparisonPlan();
    const model = getSemanticModel(plan.request.sourceId)!;
    const query = compileClickHouseQuery(plan.request, model);

    expect(query.sql).toContain("quantileTDigest");
    expect(query.sql).toContain("FROM {database:Identifier}.{table:Identifier}");
    expect(query.sql).toContain("county = {filter_0:String}");
    expect(query.sql).toContain("ORDER BY median_price DESC");
    expect(query.sql).toContain("LIMIT 41");
    expect(query.sql).not.toContain("Greater London");
    expect(query.params.filter_0).toBe("GREATER LONDON");
  });

  it("compiles against the pack's own database, ignoring the global env override", () => {
    const plan = londonComparisonPlan();
    const model = getSemanticModel(plan.request.sourceId)!;
    const previous = process.env.CLICKHOUSE_DATABASE;
    process.env.CLICKHOUSE_DATABASE = "SOMEWHERE_ELSE";
    try {
      const query = compileClickHouseQuery(plan.request, model);
      expect(query.params.database).toBe(model.database);
    } finally {
      if (previous === undefined) delete process.env.CLICKHOUSE_DATABASE;
      else process.env.CLICKHOUSE_DATABASE = previous;
    }
  });

  it("compiles a measure threshold as HAVING over the aggregate, parameterized", () => {
    const plan = planAnalysis({
      question: "Which London boroughs have a median over 500k?",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "borough" }],
      filters: [
        { field: "county", operator: "equals", value: "Greater London" },
        { field: "median price", operator: "gte", value: 500000 },
      ],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected a ready plan");
    const query = compileClickHouseQuery(plan.request, getSemanticModel(plan.request.sourceId)!);

    // The threshold thresholds aggregates, so it must sit in HAVING (after
    // GROUP BY), while the county scope stays in WHERE — and the value still
    // travels as a parameter, never in the SQL text.
    expect(query.sql).toContain("WHERE county = {filter_0:String}");
    expect(query.sql).toMatch(/GROUP BY district\nHAVING round\(quantileTDigest\(0\.5\)\(price\)\) >= \{having_1:Float64\}/);
    expect(query.sql).not.toContain("500000");
    expect(query.params.having_1).toBe(500000);
  });

  it("keeps hostile filter text out of SQL to prevent SQL injection", () => {
    const plan = londonComparisonPlan();
    plan.request.filters[0].value = "Greater London' OR 1=1 --";
    const query = compileClickHouseQuery(plan.request, getSemanticModel(plan.request.sourceId)!);
    expect(query.sql).not.toContain("OR 1=1");
    expect(query.params.filter_0).toBe("GREATER LONDON' OR 1=1 --");
  });

  it("applies scan, time, and result limits at the adapter boundary", async () => {
    const calls: unknown[] = [];
    const fakeClient = {
      query: async (options: unknown) => {
        calls.push(options);
        return {
          json: async () => [],
          query_id: "q-safe",
          response_headers: {
            "x-clickhouse-summary": JSON.stringify({
              read_rows: "0",
              read_bytes: "0",
              elapsed_ns: "1000000",
            }),
          },
        };
      },
    } as unknown as ClickHouseClient;
    const plan = londonComparisonPlan();
    const query = compileClickHouseQuery(plan.request, getSemanticModel(plan.request.sourceId)!);
    await new ClickHouseAdapter(fakeClient).execute(query);

    const options = calls[0] as { clickhouse_settings: Record<string, unknown> };
    expect(options.clickhouse_settings).toMatchObject({
      max_execution_time: 30,
      max_rows_to_read: "1000000000",
      max_bytes_to_read: "100000000000",
      max_result_rows: "41",
    });
  });

  it("lifts a trend's default limit far above the category/detail caps", () => {
    const plan = planAnalysis({
      question: "Show Lambeth prices by day since 2015",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["median price"],
      dimensions: [{ field: "sale_date", grain: "day" }],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected a ready plan");
    const query = compileClickHouseQuery(plan.request, getSemanticModel(plan.request.sourceId)!);

    expect(query.sql).toContain("LIMIT 100000");
    expect(query.resultLimit).toBe(100_000);
  });

  it("compiles a distribution as a histogram over the raw per-row value, with no GROUP BY", () => {
    const plan = planAnalysis({
      question: "How is median price distributed in Greater London?",
      sourceId: "uk-house-prices",
      analysisType: "distribution",
      measures: ["median price"],
      dimensions: [],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected a ready plan");
    const query = compileClickHouseQuery(plan.request, getSemanticModel(plan.request.sourceId)!);

    // Binning is clipped to P0.5–P99.5 so one record sale can't flatten the
    // histogram; the clipped tail is counted, and the median stays unclipped.
    expect(query.sql).toContain("quantilesTDigest(0.005, 0.995)(price)");
    expect(query.sql).toContain("histogramIf(20)(price, price BETWEEN bin_bounds[1] AND bin_bounds[2])");
    expect(query.sql).toContain("countIf(NOT (price BETWEEN bin_bounds[1] AND bin_bounds[2])) AS clipped_count");
    expect(query.sql).not.toContain("GROUP BY");
    expect(query.sql).toContain("LIMIT 1");
    expect(query.params.filter_0).toBe("GREATER LONDON");
  });
});
