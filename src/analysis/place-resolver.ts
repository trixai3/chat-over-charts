import { ClickHouseAdapter } from "./clickhouse-adapter";
import { getSemanticModel, planAnalysis } from "./semantic-model";
import type {
  AnalysisDraft,
  AnalysisFilter,
  AnalysisPlanResult,
  CompiledQuery,
  ResolvedAnalysisRequest,
  SemanticModel,
  SourceAdapter,
} from "./types";

export type PlaceCandidate = { locality: string; county: string; district: string; sales: number };

/**
 * `locality` has no snapshotted value list (24k neighbourhood names, 62% of
 * which span multiple districts — see uk-house-prices.ts), so existence is
 * checked live instead. This is the one governed SQL statement that runs
 * before a plan exists; it never carries user text into the query string.
 */
const LOOKUP_LIMIT = 8;

function syntheticRequest(sourceId: string): ResolvedAnalysisRequest {
  // Only `request` needs to typecheck for the adapter call below — the lookup
  // is hand-built SQL, not a compiled semantic query, so none of these fields
  // are read by execute().
  return {
    question: "locality lookup",
    sourceId,
    analysisType: "detail",
    measures: [],
    dimensions: [],
    filters: [],
    orderBy: [],
  };
}

/**
 * Best-effort: any adapter failure (network, timeout, permissions) resolves
 * to zero candidates rather than throwing, so a lookup failure degrades to
 * the pre-existing "unsupported" behaviour instead of crashing the plan.
 */
export async function lookupLocality(
  term: string,
  model: SemanticModel,
  adapter: SourceAdapter = new ClickHouseAdapter(),
): Promise<PlaceCandidate[]> {
  const place = term.trim().toUpperCase();
  const query: CompiledQuery = {
    sql: [
      "SELECT county, district, toUInt32(count()) AS sales",
      "FROM {database:Identifier}.{table:Identifier}",
      "WHERE locality = {place:String}",
      "GROUP BY county, district",
      "ORDER BY sales DESC",
      `LIMIT ${LOOKUP_LIMIT}`,
    ].join("\n"),
    params: {
      database: process.env.CLICKHOUSE_DATABASE ?? model.database,
      table: model.table,
      place,
    },
    request: syntheticRequest(model.id),
    dimensionAliases: ["county", "district"],
    measureAliases: ["sales"],
    resultLimit: LOOKUP_LIMIT,
  };
  try {
    const { rows } = await adapter.execute(query);
    return rows.map((row) => ({
      locality: place,
      county: String(row.county),
      district: String(row.district),
      sales: Number(row.sales),
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

function replacementFilters(
  draft: AnalysisDraft,
  term: string,
  candidate: PlaceCandidate,
): AnalysisFilter[] {
  const kept = draft.filters.filter((filter) => !matchesTerm(filter.value, term));
  return [
    ...kept,
    { field: "locality", operator: "equals", value: term },
    { field: "district", operator: "equals", value: candidate.district },
    { field: "county", operator: "equals", value: candidate.county },
  ];
}

/**
 * Wraps planAnalysis with the live place lookup: an `unsupported` plan whose
 * failing term is a place name gets one governed SQL retry before it reaches
 * the model, so "Clapham" resolves (or asks) instead of dead-ending.
 */
export async function planWithPlaceResolution(
  draft: AnalysisDraft,
  adapter?: SourceAdapter,
): Promise<AnalysisPlanResult> {
  const plan = planAnalysis(draft);
  if (plan.status !== "unsupported" || !plan.unknownValue) return plan;

  const model = getSemanticModel(draft.sourceId);
  if (!model) return plan;

  const term = plan.unknownValue.term;
  const candidates = await lookupLocality(term, model, adapter);
  if (candidates.length === 0) return plan;

  if (candidates.length === 1) {
    // A single governed interpretation is a correction, not a guess — the
    // same rule resolveFilter already applies to county/district/town matches.
    const filters = replacementFilters(draft, term, candidates[0]);
    return planAnalysis({ ...draft, filters });
  }

  return {
    status: "needs_clarification",
    resolved: { ...draft },
    ambiguities: [
      {
        field: "filters",
        question: `“${term}” matches ${candidates.length} places. Which one is meant?`,
        options: candidates.map((candidate) => ({
          id: `${candidate.district}|${candidate.county}`,
          label: `${candidate.district}, ${candidate.county} · ${candidate.sales.toLocaleString("en-GB")} sales`,
          description: `Call inspectAnalysis again replacing the "${term}" filter with locality equals "${term.toUpperCase()}", district equals "${candidate.district}", county equals "${candidate.county}".`,
        })),
        // No recommended option, deliberately: the biggest candidate is not
        // the correct one often enough that recommending it recreates the
        // "Clapham" → Bedfordshire trap this feature exists to avoid.
        reason:
          "62% of localities span multiple districts, and the populations differ materially — the choice is the user's.",
      },
    ],
  };
}
