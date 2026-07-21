import { describe, expect, it } from "vitest";
import { planAnalysis } from "../../src/analysis/semantic-model";
import { runAnalysis } from "../../src/analysis/pipeline";

const hasCredentials = Boolean(
  process.env.CLICKHOUSE_URL &&
    process.env.CLICKHOUSE_USER &&
    process.env.CLICKHOUSE_PASSWORD &&
    process.env.CLICKHOUSE_DATABASE,
);

describe.skipIf(!hasCredentials)("live UK House Price Paid integration", () => {
  it("compiles, executes, validates, and renders a London borough comparison", async () => {
    const plan = planAnalysis({
      question: "Compare London boroughs by median price",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price", "transactions"],
      dimensions: [{ field: "borough" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [{ field: "median price", direction: "desc" }],
    });
    if (plan.status !== "ready") throw new Error(`Plan was not ready: ${plan.status}`);

    const result = await runAnalysis(plan);
    expect(result.spec.kind).toBe("comparison");
    if (result.spec.kind !== "comparison") return;
    expect(result.spec.rows.length).toBeGreaterThan(20);
    expect(result.spec.rows.some((row) => row.label === "HAVERING")).toBe(true);
    expect(result.spec.stats.rowsRead).toBeGreaterThan(0);
    expect(result.spec.explanation.provenance.queryId).toBeTruthy();
  }, 30_000);

  // The 19 July failure case: this question used to compile a fixed-window
  // snapshot grouped by year (a single line of zeros). It must now produce a
  // top-N multi-series per-period change over the confirmed scope.
  it("renders per-district price change over time with a confirmed top-N scope", async () => {
    // "average price change" first trips the average guard (d1ff764): the
    // governed aggregate is a median, so the swap needs user confirmation.
    const guarded = planAnalysis({
      question: "show me average price change per district in london over time",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["price change"],
      dimensions: [{ field: "sale_date", grain: "year" }, { field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
      seriesSelection: { method: "top", n: 8 },
    });
    if (guarded.status !== "needs_clarification") {
      throw new Error(`Expected the average guard, got: ${guarded.status}`);
    }
    expect(guarded.ambiguities[0]?.recommended).toBe("median_price");

    // The confirmed re-draft: verbatim governed id plus the change comparison,
    // exactly what the clarification option instructs the model to send.
    const plan = planAnalysis({
      question: "show me average price change per district in london over time",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["median_price"],
      comparison: "vs_previous_period",
      dimensions: [{ field: "sale_date", grain: "year" }, { field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
      seriesSelection: { method: "top", n: 8 },
    });
    if (plan.status !== "ready") throw new Error(`Plan was not ready: ${plan.status}`);

    const result = await runAnalysis(plan);
    expect(result.spec.kind).toBe("timeseries");
    if (result.spec.kind !== "timeseries") return;
    expect(result.spec.series.length).toBeGreaterThan(1);
    expect(result.spec.series.length).toBeLessThanOrEqual(8);
    for (const series of result.spec.series) {
      // Every remaining point is a real year-over-year percentage, not the
      // all-zero artefact of the old window-measure SQL.
      expect(series.points.length).toBeGreaterThan(10);
      expect(series.points.some((point) => point.v !== 0)).toBe(true);
    }
  }, 30_000);

  it("renders a distribution of price in one district", async () => {
    const plan = planAnalysis({
      question: "How are prices distributed in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "distribution",
      measures: ["price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });
    if (plan.status !== "ready") throw new Error(`Plan was not ready: ${plan.status}`);

    const result = await runAnalysis(plan);
    expect(result.spec.kind).toBe("distribution");
    if (result.spec.kind !== "distribution") return;
    expect(result.spec.bins.length).toBeGreaterThan(0);
    expect(result.spec.median).toBeGreaterThan(0);
    expect(result.spec.stats.rowsRead).toBeGreaterThan(0);
  }, 30_000);

  // Improvement plan ④: a measure threshold compiles to HAVING. Proven live
  // because a stubbed adapter cannot catch ClickHouse dialect drift.
  it("filters boroughs by a median threshold via HAVING", async () => {
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
      orderBy: [{ field: "median price", direction: "desc" }],
    });
    if (plan.status !== "ready") throw new Error(`Plan was not ready: ${plan.status}`);

    const result = await runAnalysis(plan);
    expect(result.spec.kind).toBe("comparison");
    if (result.spec.kind !== "comparison") return;
    expect(result.spec.rows.length).toBeGreaterThan(0);
    // The threshold is the whole point: every surviving borough median is ≥ it.
    expect(result.spec.rows.every((row) => row.value >= 500000)).toBe(true);
    expect(result.spec.explanation.scope).toContain("Median sale price gte 500000");
  }, 30_000);

  it("compares transactions by property type as a pie-compatible figure", async () => {
    const plan = planAnalysis({
      question: "Break down transactions by property type",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "property type" }],
      filters: [],
      orderBy: [],
      preferredFigure: "pie",
    });
    if (plan.status !== "ready") throw new Error(`Plan was not ready: ${plan.status}`);
    expect(plan.figure).toBe("pie");

    const result = await runAnalysis(plan);
    // Five governed property types is well within the pie policy's 8-slice
    // cap, so the provisional pie should survive finalizeFigure unchanged.
    expect(result.spec.kind).toBe("pie");
    if (result.spec.kind !== "pie") return;
    expect(result.spec.slices.length).toBeGreaterThan(1);
    expect(result.spec.slices.every((slice) => slice.value > 0)).toBe(true);
    expect(result.spec.stats.rowsRead).toBeGreaterThan(0);
  }, 30_000);
});
