import { describe, expect, it } from "vitest";
import { planAnalysis } from "./semantic-model";
import { runAnalysis, summarizeSpec } from "./pipeline";
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

  it("renders a distribution by parsing the histogram row into bins", async () => {
    const plan = planAnalysis({
      question: "How is median price distributed in Greater London?",
      sourceId: "uk-house-prices",
      analysisType: "distribution",
      measures: ["median price"],
      dimensions: [],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          {
            bins: [
              [0, 300000, 58],
              [300000, 600000, 752],
              [600000, 1000000, 121],
            ],
            median_price: 526890,
          },
        ],
        stats,
      }),
    };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec.kind).toBe("distribution");
    if (result.spec.kind !== "distribution") return;
    expect(result.spec.bins).toEqual([
      { from: 0, to: 300000, count: 58 },
      { from: 300000, to: 600000, count: 752 },
      { from: 600000, to: 1000000, count: 121 },
    ]);
    expect(result.spec.median).toBe(526890);
  });

  it("summarizeSpec states the actual displayed window and scope, not just shape counts", async () => {
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
    const summary = summarizeSpec(result.spec);
    // The model never sees the rendered figure, so the summary — its only
    // window into what was actually plotted — must state the real first and
    // last displayed dates (never just point/series counts), plus the scope
    // strings that describe applied filters/grain in human words.
    expect(summary).toContain("displayed 2024-01-01 → 2025-01-01");
    expect(summary).toContain("scope:");
    // Improvement plan ②: bounded decision data — each series' endpoints and
    // extremes are stated so the model can reason about the trend it plotted.
    expect(summary).toContain("LAMBETH: first 535000 at 2024-01-01, last 526890 at 2025-01-01");
    expect(summary).toContain("min 526890 at 2025-01-01, max 535000 at 2024-01-01");
  });

  it("summarizeSpec lists every comparison value so the model can count and threshold", async () => {
    const plan = planAnalysis({
      question: "Compare London boroughs by median price",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "borough" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [{ field: "median price", direction: "desc" }],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { district: "WANDSWORTH", median_price: 630000 },
          { district: "LAMBETH", median_price: 526890 },
          { district: "HAVERING", median_price: 445500 },
        ],
        stats,
      }),
    };
    const summary = summarizeSpec((await runAnalysis(plan, adapter)).spec);
    expect(summary).toContain("Values: WANDSWORTH=630000; LAMBETH=526890; HAVERING=445500.");
  });

  it("summarizeSpec falls back to the base line when the detail would blow the byte budget", async () => {
    const plan = planAnalysis({
      question: "Compare towns by median price",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "town" }],
      filters: [],
      orderBy: [{ field: "median price", direction: "desc" }],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    // 40 rows × ~200-byte labels ≈ 8KB of detail — over the 4KB summary cap.
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: Array.from({ length: 40 }, (_, index) => ({
          town: `TOWN-${index}-${"X".repeat(200)}`,
          median_price: 400000 + index,
        })),
        stats,
      }),
    };
    const summary = summarizeSpec((await runAnalysis(plan, adapter)).spec);
    expect(summary).toContain("40 categories.");
    expect(summary).not.toContain("Values:");
    expect(Buffer.byteLength(summary, "utf8")).toBeLessThanOrEqual(4096);
  });

  it("summarizeSpec states every pie slice with its share", async () => {
    const plan = planAnalysis({
      question: "Share of sales by property type",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "property type" }],
      filters: [],
      orderBy: [],
      preferredFigure: "pie",
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: [
          { property_type: "terraced", transaction_count: 500 },
          { property_type: "flat", transaction_count: 300 },
          { property_type: "detached", transaction_count: 200 },
        ],
        stats,
      }),
    };
    const summary = summarizeSpec((await runAnalysis(plan, adapter)).spec);
    expect(summary).toContain("Slices: terraced 50.0%; flat 30.0%; detached 20.0%.");
  });

  it("summarizeSpec previews the first table rows", async () => {
    const plan = planAnalysis({
      question: "List boroughs with prices and volumes",
      sourceId: "uk-house-prices",
      analysisType: "detail",
      measures: ["median price"],
      dimensions: [{ field: "borough" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const adapter: SourceAdapter = {
      execute: async () => ({
        rows: Array.from({ length: 8 }, (_, index) => ({
          district: `DISTRICT-${index}`,
          median_price: 400000 + index,
        })),
        stats,
      }),
    };
    const summary = summarizeSpec((await runAnalysis(plan, adapter)).spec);
    expect(summary).toContain("8 rows");
    expect(summary).toContain("First 5 rows:");
    expect(summary).toContain("district=DISTRICT-0, median_price=400000");
    expect(summary).not.toContain("DISTRICT-5");
  });

  it("returns a too-large notice instead of streaming a spec over the byte cap", async () => {
    // Trigger.dev's chat stream rejects any single record over ~1 MiB; a
    // multi-thousand-point daily trend can cross that on its own.
    const plan = planAnalysis({
      question: "Show the daily median price trend since 2015",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["median price"],
      dimensions: [{ field: "sale_date", grain: "day" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [{ field: "sale_date", direction: "asc" }],
    });
    if (plan.status !== "ready") throw new Error("Expected ready plan");
    const rows = Array.from({ length: 30000 }, (_, index) => ({
      sale_date: new Date(Date.UTC(2015, 0, 1) + index * 86400000).toISOString().slice(0, 10),
      median_price: 400000 + (index % 50000),
    }));
    const adapter: SourceAdapter = { execute: async () => ({ rows, stats }) };
    const result = await runAnalysis(plan, adapter);
    expect(result.spec).toMatchObject({
      kind: "notice",
      title: "This figure is too large to stream",
    });
  });
});
