import { describe, expect, it } from "vitest";
import { planWithMemberResolution, resolveMember } from "../../src/analysis/member-resolver";
import { getSemanticModel } from "../../src/analysis/semantic-model";
import type { AnalysisDraft, CompiledQuery, SourceAdapter } from "../../src/analysis/types";

const model = getSemanticModel("uk-house-prices")!;
const localityResolver = model.memberResolvers![0]!;

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

describe("resolveMember", () => {
  it("compiles a parameterized leaf lookup, normalizing the term per the leaf dimension", async () => {
    const adapter = stubAdapter([{ county: "GREATER LONDON", district: "LAMBETH", _count: 559 }]);
    await resolveMember(model, localityResolver, "clapham ", adapter);
    expect(adapter.lastQuery?.sql).toContain("WHERE locality = {member:String}");
    expect(adapter.lastQuery?.params.member).toBe("CLAPHAM");
  });

  it("looks up against the pack's own database, ignoring the global env override", async () => {
    const adapter = stubAdapter([{ county: "GREATER LONDON", district: "LAMBETH", _count: 559 }]);
    const previous = process.env.CLICKHOUSE_DATABASE;
    process.env.CLICKHOUSE_DATABASE = "SOMEWHERE_ELSE";
    try {
      await resolveMember(model, localityResolver, "clapham", adapter);
      expect(adapter.lastQuery?.params.database).toBe(model.database);
    } finally {
      if (previous === undefined) delete process.env.CLICKHOUSE_DATABASE;
      else process.env.CLICKHOUSE_DATABASE = previous;
    }
  });

  it("maps rows to candidates keyed by every ancestor in the hierarchy", async () => {
    const adapter = stubAdapter([
      { county: "GREATER LONDON", district: "LAMBETH", _count: 559 },
      { county: "BEDFORDSHIRE", district: "BEDFORD", _count: 1200 },
    ]);
    const candidates = await resolveMember(model, localityResolver, "clapham", adapter);
    expect(candidates).toEqual([
      { value: "CLAPHAM", ancestors: { district: "LAMBETH", county: "GREATER LONDON" }, count: 559 },
      { value: "CLAPHAM", ancestors: { district: "BEDFORD", county: "BEDFORDSHIRE" }, count: 1200 },
    ]);
  });

  it("is best-effort: an adapter error resolves to no candidates", async () => {
    const adapter: SourceAdapter = {
      execute: async () => {
        throw new Error("connection refused");
      },
    };
    expect(await resolveMember(model, localityResolver, "clapham", adapter)).toEqual([]);
  });
});

describe("planWithMemberResolution", () => {
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
    const plan = await planWithMemberResolution(draft, stubAdapter([]));
    expect(plan.status).toBe("unsupported");
    if (plan.status !== "unsupported") return;
    expect(plan.reason).toContain("Atlantis");
  });

  it("single-hit: auto-scopes to the leaf dimension and every ancestor", async () => {
    const adapter = stubAdapter([{ county: "GREATER LONDON", district: "LAMBETH", _count: 559 }]);
    const draft: AnalysisDraft = {
      question: "How much is a house in Clapham",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["median price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Clapham" }],
      orderBy: [],
    };
    const plan = await planWithMemberResolution(draft, adapter);
    expect(plan.status).toBe("ready");
    if (plan.status !== "ready") return;
    // The leaf dimension has no snapshotted values, so it passes through
    // unnormalized at plan time — normalization happens at compile time
    // (valueNormalization).
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
      { county: "GREATER LONDON", district: "LAMBETH", _count: 559 },
      { county: "BEDFORDSHIRE", district: "BEDFORD", _count: 1200 },
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
    const plan = await planWithMemberResolution(draft, adapter);
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
