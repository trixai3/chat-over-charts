import { ClickHouseAdapter } from "./clickhouse-adapter";
import { getSemanticModel, planAnalysis } from "./semantic-model";
import type {
  AnalysisDraft,
  AnalysisFilter,
  AnalysisPlanResult,
  CompiledQuery,
  MemberResolver,
  ResolvedAnalysisRequest,
  SemanticDimension,
  SemanticModel,
  SourceAdapter,
} from "./types";

export type MemberCandidate = {
  value: string;
  /** Ancestor dimension id → value, one entry per id in `resolver.hierarchy`. */
  ancestors: Record<string, string>;
  count: number;
};

/**
 * A registered leaf dimension has no snapshotted value list (too many members
 * to sample — see each pack's dimension comment), so existence is checked
 * live instead. This is the one governed SQL statement that runs before a
 * plan exists; it never carries user text into the query string.
 */
const LOOKUP_LIMIT = 8;
const MEMBER_PARAM = "member";

function syntheticRequest(sourceId: string): ResolvedAnalysisRequest {
  // Only `request` needs to typecheck for the adapter call below — the lookup
  // is hand-built SQL, not a compiled semantic query, so none of these fields
  // are read by execute().
  return {
    question: "member lookup",
    sourceId,
    analysisType: "detail",
    measures: [],
    dimensions: [],
    filters: [],
    orderBy: [],
  };
}

// Plan-time terms arrive as raw user text; only the live lookup normalizes
// one, mirroring how resolveFilter normalizes a snapshotted value
// (semantic-model.ts) for a dimension that has no snapshot to check against.
function normalizeMemberValue(term: string, dimension: SemanticDimension): string {
  const trimmed = term.trim();
  if (dimension.valueNormalization === "uppercase") return trimmed.toUpperCase();
  if (dimension.valueNormalization === "lowercase") return trimmed.toLowerCase();
  return trimmed;
}

function ancestorDimensions(
  model: SemanticModel,
  resolver: MemberResolver,
): SemanticDimension[] | undefined {
  const dimensions = resolver.hierarchy.map((id) => model.dimensions[id]);
  return dimensions.every((dimension): dimension is SemanticDimension => Boolean(dimension))
    ? dimensions
    : undefined;
}

/**
 * Builds and runs the live lookup SQL entirely from the model and resolver:
 * count members sharing the leaf value, grouped by every ancestor in the
 * hierarchy. Nothing here is source-specific — geography, a product line
 * tree, or an org chart all resolve through the same query shape.
 *
 * Best-effort: any adapter failure (network, timeout, permissions) resolves
 * to zero candidates rather than throwing, so a lookup failure degrades to
 * the pre-existing "unsupported" behaviour instead of crashing the plan.
 */
export async function resolveMember(
  model: SemanticModel,
  resolver: MemberResolver,
  term: string,
  adapter: SourceAdapter = new ClickHouseAdapter(),
): Promise<MemberCandidate[]> {
  const leaf = model.dimensions[resolver.dimensionId];
  const ancestors = leaf ? ancestorDimensions(model, resolver) : undefined;
  if (!leaf || !ancestors) return [];

  const member = normalizeMemberValue(term, leaf);
  const query: CompiledQuery = {
    sql: [
      `SELECT ${ancestors.map((dimension) => `${dimension.expression} AS ${dimension.id}`).join(", ")}, toUInt32(count()) AS _count`,
      "FROM {database:Identifier}.{table:Identifier}",
      `WHERE ${leaf.expression} = {${MEMBER_PARAM}:${leaf.parameterType ?? "String"}}`,
      `GROUP BY ${ancestors.map((dimension) => dimension.expression).join(", ")}`,
      "ORDER BY _count DESC",
      `LIMIT ${LOOKUP_LIMIT}`,
    ].join("\n"),
    params: {
      // Same rule as compileClickHouseQuery: the pack owns its relation, so a
      // global env override cannot cross sources.
      database: model.database,
      table: model.table,
      [MEMBER_PARAM]: member,
    },
    request: syntheticRequest(model.id),
    dimensionAliases: ancestors.map((dimension) => dimension.id),
    measureAliases: ["_count"],
    resultLimit: LOOKUP_LIMIT,
  };
  try {
    const { rows } = await adapter.execute(query);
    return rows.map((row) => ({
      value: member,
      ancestors: Object.fromEntries(
        ancestors.map((dimension) => [dimension.id, String(row[dimension.id])]),
      ),
      count: Number(row._count),
    }));
  } catch {
    return [];
  }
}

function matchesTerm(value: AnalysisFilter["value"], term: string): boolean {
  const target = term.trim().toLowerCase();
  const members = Array.isArray(value) ? value : [value];
  return members.some(
    (member) => typeof member === "string" && member.trim().toLowerCase() === target,
  );
}

// Pins the leaf value together with every ancestor the lookup found for it,
// dropping whatever guess the original draft filtered by for this term.
function pinnedFilters(
  draft: AnalysisDraft,
  resolver: MemberResolver,
  term: string,
  candidate: MemberCandidate,
): AnalysisFilter[] {
  const kept = draft.filters.filter((filter) => !matchesTerm(filter.value, term));
  return [
    ...kept,
    { field: resolver.dimensionId, operator: "equals", value: term },
    ...resolver.hierarchy.map((ancestorId) => ({
      field: ancestorId,
      operator: "equals" as const,
      value: candidate.ancestors[ancestorId],
    })),
  ];
}

/**
 * Wraps planAnalysis with a live member lookup: an `unsupported` plan whose
 * unresolved term falls under a registered resolver gets one governed SQL
 * retry before it reaches the model, so "Clapham" resolves (or asks) instead
 * of dead-ending. Resolvers are tried in declaration order, stopping at the
 * first one that finds anything — this is what lets a wrong dimension guess
 * still be rescued by a finer one registered later.
 */
export async function planWithMemberResolution(
  draft: AnalysisDraft,
  adapter?: SourceAdapter,
): Promise<AnalysisPlanResult> {
  const plan = planAnalysis(draft);
  if (plan.status !== "unsupported" || !plan.unknownValue) return plan;

  const model = getSemanticModel(draft.sourceId);
  if (!model) return plan;

  const term = plan.unknownValue.term;
  for (const resolver of model.memberResolvers ?? []) {
    const candidates = await resolveMember(model, resolver, term, adapter);
    if (candidates.length === 0) continue;

    if (candidates.length === 1) {
      // A single governed interpretation is a correction, not a guess — the
      // same rule resolveFilter already applies to a snapshotted dimension.
      const filters = pinnedFilters(draft, resolver, term, candidates[0]);
      return planAnalysis({ ...draft, filters });
    }

    const leaf = model.dimensions[resolver.dimensionId]!;
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "filters",
          question: `“${term}” matches ${candidates.length} members. Which one is meant?`,
          options: candidates.map((candidate) => ({
            id: resolver.hierarchy.map((id) => candidate.ancestors[id]).join("|"),
            label: `${resolver.hierarchy.map((id) => candidate.ancestors[id]).join(", ")} · ${candidate.count.toLocaleString("en-GB")} ${resolver.countLabel}`,
            description:
              `Call inspectAnalysis again, this time filtering on ` +
              `${resolver.dimensionId} equals "${normalizeMemberValue(term, leaf)}"` +
              resolver.hierarchy
                .map((id) => `, ${id} equals "${candidate.ancestors[id]}"`)
                .join("") +
              ` instead of the "${term}" filter.`,
          })),
          // No recommended option, deliberately: nudging toward the biggest
          // candidate would reintroduce the wrong-answer guess this feature
          // exists to avoid.
          reason:
            "Members below this point in the hierarchy commonly span more than one ancestor, and the populations differ materially — the choice is the user's.",
        },
      ],
    };
  }

  return plan;
}
