import { describe, expect, it } from "vitest";
import { explainSemanticTerm } from "./semantic-model";

// "How did you calculate X?" answers come from the semantic layer alone — no
// SQL runs, and unknown terms are refused with the governed vocabulary.

describe("explainSemanticTerm", () => {
  it("explains a measure with definition, aggregation, and provenance", () => {
    const spec = explainSemanticTerm("uk-house-prices", "median price");
    expect(spec).toMatchObject({ kind: "notice", tone: "neutral" });
    if (spec.kind !== "notice") return;
    expect(spec.title).toContain("Median sale price");
    expect(spec.message).toContain("quantileTDigest");
    expect(spec.message).toContain("HM Land Registry");
  });

  it("explains 'latest median price' and notes that recency is a filter", () => {
    const spec = explainSemanticTerm("uk-house-prices", "latest median price");
    expect(spec).toMatchObject({ kind: "notice", tone: "neutral" });
    if (spec.kind !== "notice") return;
    expect(spec.title).toContain("Median sale price");
    expect(spec.message).toContain("date filter");
  });

  it("explains a dimension", () => {
    const spec = explainSemanticTerm("uk-house-prices", "borough");
    if (spec.kind !== "notice") throw new Error("expected notice");
    expect(spec.title).toContain("District");
    expect(spec.message).toContain("governed values");
  });

  it("refuses ungoverned terms with the governed vocabulary as suggestions", () => {
    const spec = explainSemanticTerm("uk-house-prices", "the meaning of life");
    if (spec.kind !== "notice") throw new Error("expected notice");
    expect(spec.tone).toBe("warning");
    expect(spec.suggestions).toContain("Median sale price");
  });
});
