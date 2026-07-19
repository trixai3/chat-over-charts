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
});
