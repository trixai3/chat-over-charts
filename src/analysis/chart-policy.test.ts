import { describe, expect, it } from "vitest";
import { finalizeFigure } from "./chart-policy";
import { planAnalysis } from "./semantic-model";

describe("governed chart policy", () => {
  it.each([
    ["single_value", [], "kpi"],
    ["trend", [{ field: "sale_date", grain: "year" }], "timeseries"],
    ["category_comparison", [{ field: "district" }], "comparison"],
    ["detail", [{ field: "district" }], "table"],
  ] as const)("maps %s intent to %s", (analysisType, dimensions, expected) => {
    const plan = planAnalysis({
      question: "Policy test",
      sourceId: "uk-house-prices",
      analysisType,
      measures: ["median_price"],
      dimensions: [...dimensions],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") expect(plan.figure).toBe(expected);
  });

  it("adapts one temporal point to a KPI", () => {
    expect(finalizeFigure("timeseries", {
      rowCount: 1,
      categoryCount: 0,
      timePointCount: 1,
      seriesCount: 1,
      truncated: false,
    })).toMatchObject({ status: "selected", kind: "kpi" });
  });

  it("refuses unreadable or incomplete results", () => {
    expect(finalizeFigure("timeseries", {
      rowCount: 90,
      categoryCount: 9,
      timePointCount: 10,
      seriesCount: 9,
      truncated: false,
    }).status).toBe("unsupported");
    expect(finalizeFigure("comparison", {
      rowCount: 41,
      categoryCount: 41,
      timePointCount: 0,
      seriesCount: 41,
      truncated: true,
    }).status).toBe("unsupported");
  });

  it("selects pie for an additive measure with a category dimension", () => {
    const plan = planAnalysis({
      question: "Transactions by property type",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "property type" }],
      filters: [],
      orderBy: [],
      preferredFigure: "pie",
    });
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") expect(plan.figure).toBe("pie");
  });

  it("refuses pie for a non-additive measure (the additivity lie)", () => {
    const plan = planAnalysis({
      question: "Median price by property type as a pie",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "property type" }],
      filters: [],
      orderBy: [],
      preferredFigure: "pie",
    });
    expect(plan.status).toBe("unsupported");
  });

  it("downgrades a pie with more than eight categories to comparison", () => {
    expect(
      finalizeFigure("pie", {
        rowCount: 9,
        categoryCount: 9,
        timePointCount: 0,
        seriesCount: 9,
        truncated: false,
      }),
    ).toMatchObject({ status: "selected", kind: "comparison" });
  });

  it("downgrades a single-series area to timeseries", () => {
    expect(
      finalizeFigure("area", {
        rowCount: 6,
        categoryCount: 1,
        timePointCount: 6,
        seriesCount: 1,
        truncated: false,
      }),
    ).toMatchObject({ status: "selected", kind: "timeseries" });
  });

  it("downgrades a scatter with fewer than three rows to a table", () => {
    expect(
      finalizeFigure("scatter", {
        rowCount: 2,
        categoryCount: 2,
        timePointCount: 0,
        seriesCount: 2,
        truncated: false,
      }),
    ).toMatchObject({ status: "selected", kind: "table" });
  });

  it("plans a distribution for median price as ready", () => {
    const plan = planAnalysis({
      question: "How is median price distributed?",
      sourceId: "uk-house-prices",
      analysisType: "distribution",
      measures: ["median price"],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") expect(plan.figure).toBe("distribution");
  });

  it("refuses a distribution over a measure with no per-row value", () => {
    const plan = planAnalysis({
      question: "How are transactions distributed?",
      sourceId: "uk-house-prices",
      analysisType: "distribution",
      measures: ["transactions"],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("unsupported");
  });

  it("refuses a distribution with a dimension", () => {
    const plan = planAnalysis({
      question: "How is median price distributed by district?",
      sourceId: "uk-house-prices",
      analysisType: "distribution",
      measures: ["median price"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("unsupported");
  });

  it("lists pie as an alternative for an additive category comparison", () => {
    const plan = planAnalysis({
      question: "Transactions by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") expect(plan.figureAlternatives).toContain("pie");
  });

  it("excludes pie from alternatives when a measure is non-additive", () => {
    const plan = planAnalysis({
      question: "Median price and transactions by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price", "transactions"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") {
      expect(plan.figureAlternatives).toContain("scatter");
      expect(plan.figureAlternatives).not.toContain("pie");
    }
  });

  it("suggests only the genuinely compatible figures when a pie is requested for a non-additive measure", () => {
    const plan = planAnalysis({
      question: "Median price by property type as a pie",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "property type" }],
      filters: [],
      orderBy: [],
      preferredFigure: "pie",
    });
    expect(plan.status).toBe("unsupported");
    if (plan.status === "unsupported") {
      expect(plan.suggestions).toContain("comparison");
      expect(plan.suggestions).toContain("table");
      expect(plan.suggestions).not.toContain("pie");
    }
  });

  it("lists area as an alternative for a trend with a category dimension and additive measure", () => {
    const plan = planAnalysis({
      question: "Transactions by month by property type",
      sourceId: "uk-house-prices",
      analysisType: "trend",
      measures: ["transactions"],
      dimensions: [{ field: "sale_date", grain: "month" }, { field: "property type" }],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status === "ready") expect(plan.figureAlternatives).toContain("area");
  });
});
