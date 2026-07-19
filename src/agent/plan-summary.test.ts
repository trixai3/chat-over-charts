import { describe, expect, it } from "vitest";
import { planAnalysis } from "../analysis/semantic-model";
import { planSummary } from "./tools";

describe("planSummary", () => {
  it("READY summary states the chosen figure and lists compatible alternatives", () => {
    const plan = planAnalysis({
      question: "Compare transactions by district",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "district" }],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") throw new Error("expected a ready plan");

    // transaction_count is additive and there is exactly one category
    // dimension and no time dimension, so pie is a genuinely compatible
    // alternative to the registered default (comparison).
    expect(plan.figureAlternatives).toContain("pie");

    const summary = planSummary(plan);
    expect(summary).toContain("READY");
    expect(summary).toContain(`figure=${plan.figure}`);
    expect(summary).toContain("alternatives=");
    expect(summary).toMatch(/alternatives=[^;]*\bpie\b/);
  });

  it("NEEDS_CLARIFICATION summary relays the aggregationNote-derived question", () => {
    const plan = planAnalysis({
      question: "What's the average house price in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["average price"],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") throw new Error("expected a clarification plan");

    // The governed measure is a median, so the guardrail's question must carry
    // the median's own aggregationNote — not a generic "pick a measure" ask.
    expect(plan.ambiguities[0]?.recommended).toBe("median_price");
    expect(plan.ambiguities[0]?.question).toContain("right-skewed");

    const summary = planSummary(plan);
    expect(summary).toContain("NEEDS_CLARIFICATION");
    expect(summary).toContain("right-skewed");
    expect(summary).toContain("recommended=median_price");
    expect(summary).toContain("call requestClarification");
  });

  it("does not mention median or right-skewed for a non-median aggregation mismatch", () => {
    const plan = planAnalysis({
      question: "average transactions in Lambeth",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["average transactions"],
      dimensions: [],
      filters: [],
      orderBy: [],
    });
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") throw new Error("expected a clarification plan");

    // transaction_count has no aggregationNote, so the guardrail must fall
    // back to the generic "governed equivalent" wording, not the median copy.
    expect(plan.ambiguities[0]?.recommended).toBe("transaction_count");
    expect(plan.ambiguities[0]?.question).not.toMatch(/median/i);
    expect(plan.ambiguities[0]?.question).not.toMatch(/right-skewed/i);

    // The options list still offers every governed measure (including the
    // median), so only the guardrail's own question text is asserted here —
    // not the full summary, which legitimately lists median_price as a choice.
    const summary = planSummary(plan);
    expect(summary).not.toContain("right-skewed");
  });
});
