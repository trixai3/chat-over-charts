import { describe, expect, it } from "vitest";
import { planAnalysis } from "./semantic-model";
import { runAnalysis } from "./pipeline";
import type { SourceAdapter } from "./types";

const stats = { rowsRead: 4030464, bytesRead: 120000000, elapsedMs: 45, queryId: "uk-test" };

describe("governed figure pipeline with UK house-price data", () => {
  it("renders a real-shaped London comparison with explanation and provenance", async () => {
    const plan = planAnalysis({
      question: "Compare London boroughs by median price",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price", "transactions"],
      dimensions: [{ field: "borough" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [{ field: "median price", direction: "desc" }],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { district: "WANDSWORTH", median_price: 630000, transaction_count: 121000 },
          { district: "LAMBETH", median_price: 526890, transaction_count: 104000 },
          { district: "HAVERING", median_price: 445500, transaction_count: 98000 },
        ],
        stats,
      }),
    };

    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("comparison");
    if (result.spec.kind !== "comparison") return;
    expect(result.spec.rows[0]).toMatchObject({ label: "WANDSWORTH", value: 630000, delta: 121000 });
    expect(result.spec.explanation.calculation).toContain("quantileTDigest median");
    expect(result.spec.explanation.provenance.source).toBe("HM Land Registry Price Paid Data");
    expect(result.spec.explanation.inspect.generatedSql).toContain("{filter_0:String}");
  });

  it("renders a multi-series trend using the same generic tool path", async () => {
    const plan = planAnalysis({
      question: "Compare Lambeth and Havering prices by year",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["median price"],
      dimensions: [{ field: "year", grain: "year" }, { field: "borough" }],
      filters: [
        { field: "county", operator: "equals", value: "Greater London" },
        { field: "borough", operator: "in", value: ["Lambeth", "Havering"] },
      ],
      orderBy: [{ field: "sale_date", direction: "asc" }],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { sale_date: "2024-01-01", district: "HAVERING", median_price: 440000 },
          { sale_date: "2025-01-01", district: "HAVERING", median_price: 445500 },
          { sale_date: "2024-01-01", district: "LAMBETH", median_price: 535000 },
          { sale_date: "2025-01-01", district: "LAMBETH", median_price: 526890 },
        ],
        stats,
      }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("timeseries");
    if (result.spec.kind === "timeseries") {
      expect(result.spec.series.map((series) => series.label)).toEqual(["HAVERING", "LAMBETH"]);
      expect(result.spec.series[0].points).toHaveLength(2);
    }
  });

  it("refuses duplicate grain instead of rendering misleading data", async () => {
    const plan = planAnalysis({
      question: "Median price by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { district: "LAMBETH", median_price: 526890 },
          { district: "LAMBETH", median_price: 530000 },
        ],
        stats,
      }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec).toMatchObject({ kind: "notice", tone: "error" });
  });

  it("renders KPI and table variants through the same pipeline", async () => {
    const kpiPlan = planAnalysis({
      question: "What is the median price in Greater London?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["median price"],
      dimensions: [],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    if (kpiPlan.status !== "ready") throw new Error("Expected ready KPI plan");
    const kpi = await runAnalysis(kpiPlan, {
      execute: async () => ({ rows: [{ median_price: 515000 }], stats }),
    });
    expect(kpi.spec).toMatchObject({ kind: "kpi", value: 515000 });

    const tablePlan = planAnalysis({
      question: "List property types and median price in Greater London",
      sourceId: "uk-house-prices",
      analysisType: "detail",
      measures: ["median price", "transactions"],
      dimensions: [{ field: "property type" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    if (tablePlan.status !== "ready") throw new Error("Expected ready table plan");
    const table = await runAnalysis(tablePlan, {
      execute: async () => ({
        rows: [
          { property_type: "flat", median_price: "430000", transaction_count: "200000" },
          { property_type: "terraced", median_price: "510000", transaction_count: "150000" },
        ],
        stats,
      }),
    });
    expect(table.spec.kind).toBe("table");
    if (table.spec.kind === "table") {
      expect(table.spec.rows[0].median_price).toBe(430000);
      expect(table.spec.columns).toHaveLength(3);
    }
  });

  it("does not silently render a category result that hits the safety sentinel", async () => {
    const plan = planAnalysis({
      question: "Compare every district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const rows = Array.from({ length: 41 }, (_, index) => ({
      district: `DISTRICT ${index + 1}`,
      median_price: 300000 + index * 1000,
    }));
    const result = await runAnalysis(plan, {
      execute: async () => ({ rows, stats }),
    });
    expect(result.spec).toMatchObject({
      kind: "notice",
      message: expect.stringContaining("safety result cap"),
    });
  });
});
