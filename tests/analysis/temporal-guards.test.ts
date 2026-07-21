import { describe, expect, it } from "vitest";
import { compileClickHouseQuery } from "../../src/analysis/clickhouse-adapter";
import { runAnalysis } from "../../src/analysis/pipeline";
import { getSemanticModel, planAnalysis } from "../../src/analysis/semantic-model";
import type { SourceAdapter } from "../../src/analysis/types";

const stats = { rowsRead: 1000, bytesRead: 1000, elapsedMs: 5, queryId: "guard-test" };

// Measures are plain aggregates; "change over time" is the request-level
// comparison. These tests pin the guards that keep loose wording from ever
// again compiling meaningless SQL (the 19 July failure).

describe("measure resolution", () => {
  it("asks instead of silently defaulting when no measure is named", () => {
    const plan = planAnalysis({
      question: "Show something about London",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: [],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].field).toBe("measures");
  });

  it("resolves 'price change' to the base measure plus the comparison", () => {
    const plan = planAnalysis({
      question: "Price change for Lambeth and Havering by year",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["price change"],
      dimensions: [{ field: "sale_date", grain: "year" }, { field: "district" }],
      filters: [{ field: "district", operator: "in", value: ["Lambeth", "Havering"] }],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.measures).toEqual(["median_price"]);
    expect(plan.request.comparison).toBe("vs_previous_period");
  });

  it("surfaces the median policy when the user asks for an average", () => {
    const plan = planAnalysis({
      question: "show me average price change per district in london over time",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["average price change"],
      dimensions: [{ field: "sale_date", grain: "year" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].recommended).toBe("median_price");
    expect(plan.ambiguities[0].question).toContain("median");
    expect(plan.ambiguities[0].question).toContain("vs_previous_period");
  });
});

describe("the one temporal rule: comparison requires ordered periods", () => {
  it("refuses a previous-period comparison without a time dimension", () => {
    const plan = planAnalysis({
      question: "Price change by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["price change"],
      dimensions: [{ field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    expect(plan.status).toBe("unsupported");
    if (plan.status !== "unsupported") return;
    expect(plan.reason).toContain("time dimension");
  });
});

describe("recency guard: 'latest' must map to a governed window", () => {
  const latestDraft = (filters: Array<{ field: string; operator: "equals" | "gte"; value: string }>) => ({
    question: "For detached houses, get top 10 district with latest median price in London",
    sourceId: "uk-house-prices",
    analysisType: "category_comparison" as const,
    measures: ["latest median price"],
    dimensions: [{ field: "district" }],
    filters: [
      { field: "county", operator: "equals" as const, value: "Greater London" },
      { field: "property type", operator: "equals" as const, value: "detached" },
      ...filters,
    ],
    orderBy: [],
    limit: 10,
  });

  it("asks which window 'latest' means when nothing pins it", () => {
    const plan = planAnalysis(latestDraft([]));
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].field).toBe("filters");
    expect(plan.ambiguities[0].recommended).toBe("trailing_12_months");
    // Options are anchored to the source's real freshness, not today's date.
    expect(plan.ambiguities[0].options[0].description).toContain("2025-05-29");
  });

  it("passes silently once a time filter pins the window", () => {
    const plan = planAnalysis(
      latestDraft([{ field: "date", operator: "gte", value: "2025-05-29" }]),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    // "latest median price" resolved to the base measure via recency stripping.
    expect(plan.request.measures).toEqual(["median_price"]);
  });

  it("does not fire on trends — the time dimension shows every period", () => {
    const plan = planAnalysis({
      question: "How have prices changed recently in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["price change"],
      dimensions: [{ field: "sale_date", grain: "year" }],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
  });
});

describe("pre-query series scope (design §5.4/§9.1)", () => {
  it("asks for a series scope before querying a wide category trend", () => {
    const plan = planAnalysis({
      question: "Price change per district over time",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["price change"],
      dimensions: [{ field: "sale_date", grain: "year" }, { field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].field).toBe("seriesSelection");
    expect(plan.ambiguities[0].recommended).toBe("top_series");
  });

  it("compiles a confirmed top-N selection and the comparison window into SQL", () => {
    const plan = planAnalysis({
      question: "Price change per district over time",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["price change"],
      dimensions: [{ field: "sale_date", grain: "year" }, { field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
      seriesSelection: { method: "top", n: 8 },
    });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.seriesSelection).toEqual({
      method: "top",
      n: 8,
      by: "transaction_count",
    });

    const query = compileClickHouseQuery(plan.request, getSemanticModel("uk-house-prices")!);
    expect(query.sql).toContain("lagInFrame");
    expect(query.sql).toContain("WINDOW trend_window AS (PARTITION BY district ORDER BY sale_date");
    expect(query.sql).toContain("IN (\n  SELECT district");
    expect(query.sql).toContain("ORDER BY count() DESC\n  LIMIT 8");
    // Values still travel as parameters, in the subquery too.
    expect(query.sql).not.toContain("GREATER LONDON");
  });
});

describe("comparison rows through the pipeline", () => {
  it("drops the null first period per series and renders percent values", async () => {
    const plan = planAnalysis({
      question: "Price change for Lambeth and Havering by year",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["price change"],
      dimensions: [{ field: "sale_date", grain: "year" }, { field: "district" }],
      filters: [{ field: "district", operator: "in", value: ["Lambeth", "Havering"] }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error(`Expected ready plan, got ${plan.status}`);
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { sale_date: "2023-01-01", district: "HAVERING", median_price: null },
          { sale_date: "2024-01-01", district: "HAVERING", median_price: 3.1 },
          { sale_date: "2025-01-01", district: "HAVERING", median_price: 1.2 },
          { sale_date: "2023-01-01", district: "LAMBETH", median_price: null },
          { sale_date: "2024-01-01", district: "LAMBETH", median_price: -0.8 },
          { sale_date: "2025-01-01", district: "LAMBETH", median_price: -1.5 },
        ],
        stats,
      }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("timeseries");
    if (result.spec.kind !== "timeseries") return;
    expect(result.spec.series).toHaveLength(2);
    expect(result.spec.series[0].points).toHaveLength(2);
    expect(result.spec.format).toMatchObject({ style: "percent" });
    expect(result.spec.title).toContain("% change vs previous period");
    expect(
      result.spec.explanation.limitations.some((item) => item.includes("first displayed period")),
    ).toBe(true);
  });
});
