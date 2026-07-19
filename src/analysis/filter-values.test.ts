import { describe, expect, it } from "vitest";
import { planAnalysis } from "./semantic-model";

// Value-level filter governance: the field resolver alone let "london" compile
// to county = 'LONDON' (zero rows — the stored value is GREATER LONDON).
// Values are now validated against the domains snapshotted at onboarding.

function comparisonDraft(filter: {
  field: string;
  operator: "equals" | "in";
  value: string | string[];
}) {
  return {
    question: "Compare districts",
    sourceId: "uk-house-prices",
    analysisType: "category_comparison" as const,
    measures: ["median price"],
    dimensions: [{ field: "district" }],
    filters: [filter],
    orderBy: [],
  };
}

describe("governed filter values", () => {
  it("passes exact values in any casing", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "county", operator: "equals", value: "Greater London" }),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters[0].value).toBe("Greater London");
  });

  it("disambiguates 'london' across governed geographies instead of querying zero rows", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "county", operator: "equals", value: "London" }),
    );
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    const ambiguity = plan.ambiguities[0];
    expect(ambiguity.field).toBe("filters");
    const ids = ambiguity.options.map((option) => option.id);
    expect(ids).toContain("town=LONDON");
    expect(ids).toContain("county=GREATER LONDON");
    // Exact value match is the default; broader containing geographies are offered.
    expect(ambiguity.recommended).toBe("town=LONDON");
  });

  it("auto-applies the only governed interpretation as a correction", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "property type", operator: "equals", value: "flats" }),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters[0]).toMatchObject({ field: "property_type", value: "flat" });
  });

  it("accepts an in-list of exact district values", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "district", operator: "in", value: ["Lambeth", "Havering"] }),
    );
    expect(plan.status).toBe("ready");
  });

  it("infers the field from reference data when the field term is unknown", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "location", operator: "equals", value: "Lambeth" }),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters[0]).toMatchObject({ field: "district", value: "LAMBETH" });
  });

  it("infers one shared dimension for an in-list with an unknown field", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "place", operator: "in", value: ["Lambeth", "Havering"] }),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters[0]).toMatchObject({
      field: "district",
      value: ["LAMBETH", "HAVERING"],
    });
  });

  it("never questions an exact value just because a fragment of it exists elsewhere", () => {
    // "GREATER LONDON" contains the town value "LONDON", but nobody typing the
    // full county name means the fragment — it must resolve silently, even
    // when the LLM guessed the wrong field.
    const plan = planAnalysis(
      comparisonDraft({ field: "area", operator: "equals", value: "Greater London" }),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters[0]).toMatchObject({ field: "county", value: "GREATER LONDON" });
  });

  it("still asks when an unknown field carries a genuinely ambiguous value", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "place", operator: "equals", value: "London" }),
    );
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    // The question is about the value's population — never "which field is this?"
    expect(plan.ambiguities[0].field).toBe("filters");
    expect(plan.ambiguities[0].options.map((option) => option.id)).toContain(
      "county=GREATER LONDON",
    );
  });

  it("falls back to the field clarification when the value matches nothing", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "region", operator: "equals", value: "Atlantis" }),
    );
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    expect(plan.ambiguities[0].question).toContain("region");
  });

  it("normalizes bare-year time bounds instead of failing at query time", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "date", operator: "gte" as never, value: "2015" }),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters[0]).toMatchObject({ field: "sale_date", value: "2015-01-01" });
  });

  it("reads a year-equals filter as the whole year", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "sale date", operator: "equals", value: "2015" }),
    );
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    expect(plan.request.filters[0]).toMatchObject({
      operator: "between",
      value: ["2015-01-01", "2015-12-31"],
    });
  });

  it("refuses an unparseable date before SQL exists", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "date", operator: "gte" as never, value: "recently" }),
    );
    expect(plan.status).toBe("unsupported");
  });

  it("refuses a value that exists nowhere in the governed domains", () => {
    const plan = planAnalysis(
      comparisonDraft({ field: "county", operator: "equals", value: "Atlantis" }),
    );
    expect(plan.status).toBe("unsupported");
    if (plan.status !== "unsupported") return;
    expect(plan.reason).toContain("Atlantis");
  });
});
