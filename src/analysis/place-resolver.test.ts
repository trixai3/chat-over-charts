import { describe, expect, it } from "vitest";
import { lookupLocality, planWithPlaceResolution } from "./place-resolver";
import { getSemanticModel } from "./semantic-model";
import type { AnalysisDraft, CompiledQuery, SourceAdapter } from "./types";

const model = getSemanticModel("uk-house-prices")!;

function stubAdapter(rows: Array<Record<string, unknown>>): SourceAdapter & {
  lastQuery?: CompiledQuery;
} {
  const adapter: SourceAdapter & { lastQuery?: CompiledQuery } = {
    async execute(query) {
      adapter.lastQuery = query;
      return {
        rows,
        stats: { rowsRead: rows.length, bytesRead: 0, elapsedMs: 1, queryId: "test" },
      };
    },
  };
  return adapter;
}

describe("lookupLocality", () => {
  it("compiles a parameterized locality lookup, uppercasing and trimming the term", async () => {
    const adapter = stubAdapter([{ county: "GREATER LONDON", district: "LAMBETH", sales: 559 }]);
    await lookupLocality("clapham ", model, adapter);
    expect(adapter.lastQuery?.sql).toContain("WHERE locality = {place:String}");
    expect(adapter.lastQuery?.params.place).toBe("CLAPHAM");
  });

  it("maps rows to candidates", async () => {
    const adapter = stubAdapter([
      { county: "GREATER LONDON", district: "LAMBETH", sales: 559 },
      { county: "BEDFORDSHIRE", district: "BEDFORD", sales: 1200 },
    ]);
    const candidates = await lookupLocality("clapham", model, adapter);
    expect(candidates).toEqual([
      { locality: "CLAPHAM", county: "GREATER LONDON", district: "LAMBETH", sales: 559 },
      { locality: "CLAPHAM", county: "BEDFORDSHIRE", district: "BEDFORD", sales: 1200 },
    ]);
  });

  it("is best-effort: an adapter error resolves to no candidates", async () => {
    const adapter: SourceAdapter = {
      execute: async () => {
        throw new Error("connection refused");
      },
    };
    expect(await lookupLocality("clapham", model, adapter)).toEqual([]);
  });
});

describe("planWithPlaceResolution", () => {
  it("zero-hit: leaves the plan unsupported with its original reason", async () => {
    const draft: AnalysisDraft = {
      question: "How much is a house in Atlantis",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["median price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Atlantis" }],
      orderBy: [],
    };
    const plan = await planWithPlaceResolution(draft, stubAdapter([]));
    expect(plan.status).toBe("unsupported");
    if (plan.status !== "unsupported") return;
    expect(plan.reason).toContain("Atlantis");
  });

  it("single-hit: auto-scopes to locality, district, and county", async () => {
    const adapter = stubAdapter([{ county: "GREATER LONDON", district: "LAMBETH", sales: 559 }]);
    const draft: AnalysisDraft = {
      question: "How much is a house in Clapham",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["median price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Clapham" }],
      orderBy: [],
    };
    const plan = await planWithPlaceResolution(draft, adapter);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    // Locality has no snapshotted values, so it passes through unnormalized at
    // plan time — normalization happens at compile time (valueNormalization).
    expect(plan.request.filters).toEqual(
      expect.arrayContaining([
        { field: "locality", operator: "equals", value: "Clapham" },
        { field: "district", operator: "equals", value: "LAMBETH" },
        { field: "county", operator: "equals", value: "GREATER LONDON" },
      ]),
    );
  });

  it("multi-hit: needs_clarification with candidate options and no recommendation", async () => {
    const adapter = stubAdapter([
      { county: "GREATER LONDON", district: "LAMBETH", sales: 559 },
      { county: "BEDFORDSHIRE", district: "BEDFORD", sales: 1200 },
    ]);
    const draft: AnalysisDraft = {
      question: "How much is a house in Clapham",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["median price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Clapham" }],
      orderBy: [],
    };
    const plan = await planWithPlaceResolution(draft, adapter);
    expect(plan.status).toBe("needs_clarification");
    if (plan.status !== "needs_clarification") return;
    const ambiguity = plan.ambiguities[0];
    expect(ambiguity.options).toHaveLength(2);
    expect(ambiguity.recommended).toBeUndefined();
    expect(ambiguity.options.some((option) => option.label === "LAMBETH, GREATER LONDON · 559 sales")).toBe(
      true,
    );
  });
});
