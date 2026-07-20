import { describe, expect, it } from "vitest";
import { buildMeasures } from "./measure-grammar";
import { planAnalysis } from "./semantic-model";
import { ukHousePrices } from "./models/uk-house-prices";

describe("measure grammar", () => {
  const price = ukHousePrices.valueFields!.price;

  it("generates one governed measure per vetted aggregation, ids stable", () => {
    const measures = buildMeasures(price);
    expect(Object.keys(measures)).toEqual([
      "median_price",
      "p25_price",
      "p75_price",
      "p90_price",
      "max_price",
    ]);
    // The default aggregation owns the bare-field wording: "price" alone
    // must keep meaning the median, exactly as before the grammar existed.
    expect(measures.median_price.synonyms).toContain("price");
    expect(measures.p90_price.synonyms).not.toContain("price");
    expect(measures.median_price.expression).toBe("round(quantileTDigest(0.5)(price))");
    expect(measures.p90_price.expression).toBe("round(quantileTDigest(0.9)(price))");
  });

  it("appends the aggregation's own caveat to the field limitations", () => {
    const measures = buildMeasures(price);
    expect(measures.max_price.limitations.at(-1)).toMatch(/single unusual transaction/);
    expect(measures.median_price.limitations).toHaveLength(1);
  });

  it("resolves a composed measure the model authored from the menu", () => {
    const plan = planAnalysis({
      question: "top price for detached houses in Greater London",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: [{ field: "price", aggregation: "p90" }],
      dimensions: [],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.measures).toEqual(["p90_price"]);
  });

  it("still resolves natural wording through generated synonyms", () => {
    const plan = planAnalysis({
      question: "entry price in Lambeth",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["entry price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.measures).toEqual(["p25_price"]);
  });

  it("clarifies instead of guessing when a composed field is ungoverned", () => {
    const plan = planAnalysis({
      question: "top rent in Lambeth",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: [{ field: "rent", aggregation: "p90" }],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0]?.question).toContain("names no governed value field");
  });

  it("keeps the average guard: composed medians do not bypass §9.1", () => {
    const plan = planAnalysis({
      question: "average price in Lambeth",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: [{ field: "price", aggregation: "median" }],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });
    // The user said "average"; a model-composed median is not user confirmation.
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0]?.recommended).toBe("median_price");
  });
});
