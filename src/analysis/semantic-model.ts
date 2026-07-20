import type { ViewSpec } from "../shared/view-spec";
import { ukHousePrices } from "./models/uk-house-prices";
import type {
  AnalysisDraft,
  AnalysisField,
  AnalysisFilter,
  AnalysisPlanResult,
  AnalysisType,
  SemanticDimension,
  SemanticMeasure,
  SemanticModel,
  SeriesSelection,
} from "./types";
import { MAX_LINE_SERIES, selectProvisionalFigure } from "./chart-policy";

const MODELS: Record<string, SemanticModel> = {
  [ukHousePrices.id]: ukHousePrices,
};

export function getSemanticModel(id: string): SemanticModel | undefined {
  return MODELS[id];
}

export function listSemanticModels(): SemanticModel[] {
  return Object.values(MODELS);
}

/** Trusted onboarding seam used by application modules and isolated tests. */
export function registerSemanticModel(model: SemanticModel): () => void {
  if (MODELS[model.id]) throw new Error(`Semantic model already registered: ${model.id}`);
  MODELS[model.id] = model;
  return () => {
    delete MODELS[model.id];
  };
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replaceAll("-", " ");
}

/** Words that mean "a time window", never part of a governed measure name. */
const RECENCY_WORDS = /\b(latest|current|recent|newest|now|nowadays|today)\b/gi;

/** Words that claim a mean — the aggregation this source deliberately avoids for skewed measures. */
const AVERAGE_WORDS = /\b(average|avg|mean)\b/i;

export function stripRecencyWords(term: string): string {
  return term.replace(RECENCY_WORDS, " ").replace(/\s+/g, " ").trim();
}

function stripChangeWords(term: string) {
  const base = term
    .replace(/\b(change|changes|growth|grew|increase|decrease|delta)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { base, hadChangeWord: normalized(base) !== normalized(term) };
}

/** Strips a trailing "s" from each word ("median prices" -> "median price"). Not stemming. */
function singularized(value: string): string {
  return value.replace(/(\w)s\b/g, "$1");
}

/**
 * Tried in order; the first transform whose result matches exactly wins. Only
 * pure rewrites belong here — anything with semantic side effects (change
 * words implying a comparison) stays in planAnalysis.
 */
const TERM_TRANSFORMS: Array<(term: string) => string> = [(term) => term, singularized];

function resolveEntryExact<T extends SemanticMeasure | SemanticDimension>(
  target: string,
  entries: Record<string, T>,
): T | undefined {
  return Object.values(entries).find(
    (entry) =>
      normalized(entry.id) === target ||
      normalized(entry.label) === target ||
      entry.synonyms.some((synonym) => normalized(synonym) === target),
  );
}

/**
 * Two-tier matching, tier one: exact, after a declared transform. Users
 * pluralize governed terms ("median prices", "transactions counts");
 * synonym lists stay singular (design decision, not an omission), so
 * TERM_TRANSFORMS absorbs the plural here instead of every entry
 * enumerating both forms. Transforms run in order and stop at the first
 * exact hit, so registered synonyms that already happen to be plural (e.g.
 * "transactions") keep resolving on the identity pass, unaffected by the
 * singularized retry.
 */
function resolveEntry<T extends SemanticMeasure | SemanticDimension>(
  term: string,
  entries: Record<string, T>,
): T | undefined {
  const target = normalized(term);
  for (const transform of TERM_TRANSFORMS) {
    const hit = resolveEntryExact(transform(target), entries);
    if (hit) return hit;
  }
  return undefined;
}

/** Anything within this many edits still counts as "probably meant that",
 *  but only for ranking a clarification's `recommended` option — see
 *  suggestEntry/suggestValues below. Two-tier policy tier two: fuzzy never
 *  auto-applies. */
const FUZZY_MAX_DISTANCE = 2;

/**
 * Plain DP Levenshtein distance. Governed terms are short (a handful of
 * words), so this is called at clarification time only, never per-row —
 * cheap enough without a library. Capped early once a row's minimum exceeds
 * maxDistance, since callers only care whether the result is <= threshold.
 */
function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Best governed entry within edit distance 2 of the term, for ranking
 * clarification recommendations ONLY — fuzzy matches never auto-apply.
 */
function suggestEntry<T extends SemanticMeasure | SemanticDimension>(
  term: string,
  entries: Record<string, T>,
): T | undefined {
  const target = normalized(term);
  let best: { entry: T; distance: number } | undefined;
  for (const entry of Object.values(entries)) {
    const names = [entry.id, entry.label, ...entry.synonyms];
    for (const name of names) {
      const distance = levenshteinDistance(target, normalized(name), FUZZY_MAX_DISTANCE);
      if (distance <= FUZZY_MAX_DISTANCE && (!best || distance < best.distance)) {
        best = { entry, distance };
      }
    }
  }
  return best?.entry;
}

function resolveField(field: AnalysisField, model: SemanticModel): AnalysisField | undefined {
  const dimension = resolveEntry(field.field, model.dimensions);
  if (!dimension) return undefined;
  if (field.grain && (!dimension.grains || !dimension.grains[field.grain])) return undefined;
  return { field: dimension.id, grain: field.grain };
}

function normalizedFilterValue(value: string, dimension: SemanticDimension): string {
  if (dimension.valueNormalization === "uppercase") return value.toUpperCase();
  if (dimension.valueNormalization === "lowercase") return value.toLowerCase();
  return value;
}

/**
 * Governed values of `dimension` within edit distance 2 of `term`, closest
 * first — phrasing for a "Did you mean" suggestion only. The filter still
 * returns unsupported either way: value typos ask, they never guess.
 */
function suggestValues(term: string, dimension: SemanticDimension): string[] {
  if (!dimension.values) return [];
  const target = normalizedFilterValue(term, dimension);
  return dimension.values
    .map((value) => ({ value, distance: levenshteinDistance(target, value, FUZZY_MAX_DISTANCE) }))
    .filter((candidate) => candidate.distance <= FUZZY_MAX_DISTANCE)
    .sort((a, b) => a.distance - b.distance)
    .map((candidate) => candidate.value);
}

type ValueCandidate = { dimension: SemanticDimension; value: string; exact: boolean };

/**
 * Search every governed value domain for a user-supplied filter value. "London"
 * is an exact town, but also part of the county GREATER LONDON and the district
 * CITY OF LONDON — each a materially different population.
 *
 * Matching is asymmetric on purpose. A governed value that CONTAINS the term
 * ("London" → GREATER LONDON) is a genuine broader reading and always competes.
 * A governed value that is merely a FRAGMENT of the term ("Greater London" ⊃
 * town LONDON) only counts when nothing matches exactly — no one who typed the
 * full county name meant the fragment.
 */
function findValueCandidates(term: string, model: SemanticModel): ValueCandidate[] {
  const exact: ValueCandidate[] = [];
  const broader: ValueCandidate[] = [];
  const fragments: ValueCandidate[] = [];
  for (const dimension of Object.values(model.dimensions)) {
    if (dimension.kind !== "category" || !dimension.values) continue;
    const target = normalizedFilterValue(term, dimension);
    if (target.length === 0) continue;
    for (const value of dimension.values) {
      if (value === target) exact.push({ dimension, value, exact: true });
      else if (value.includes(target)) broader.push({ dimension, value, exact: false });
      else if (target.includes(value)) fragments.push({ dimension, value, exact: false });
    }
  }
  const candidates =
    exact.length > 0 ? [...exact, ...broader] : [...broader, ...fragments];
  // Exact matches first, then coarser (lower-cardinality) geographies.
  return candidates.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      (a.dimension.cardinality ?? a.dimension.values!.length) -
        (b.dimension.cardinality ?? b.dimension.values!.length) ||
      a.value.localeCompare(b.value),
  );
}

type FilterResolution =
  | { status: "ok"; filter: AnalysisFilter }
  | { status: "unknown_field" }
  | { status: "ambiguous_value"; term: string; candidates: ValueCandidate[] }
  | { status: "unknown_value"; term: string; dimension: SemanticDimension };

/**
 * Resolves the filter field through synonyms, then validates string values for
 * equals/in against the dimension's governed value domain (design §5.3
 * "multiple possible matches" / §5.4). Dimensions without a snapshot keep the
 * old passthrough behaviour.
 */
/**
 * When the field term is unknown ("location", "place"), the reference data can
 * usually answer without asking: look the VALUE up across every governed value
 * domain. "Lambeth" appears only as a district, so field and value both
 * resolve; only a genuinely ambiguous value (e.g. "London") needs a question.
 */
function inferFieldFromValue(
  filter: AnalysisFilter,
  model: SemanticModel,
): FilterResolution | undefined {
  const terms = Array.isArray(filter.value) ? filter.value : [filter.value];
  if (filter.operator !== "equals" && filter.operator !== "in") return undefined;
  if (!terms.every((term) => typeof term === "string")) return undefined;

  const perTerm = (terms as string[]).map((term) => ({
    term,
    candidates: findValueCandidates(term, model),
  }));
  if (perTerm.some((entry) => entry.candidates.length === 0)) return undefined;

  // A dimension fits when every term resolves to exactly one value inside it.
  const fittingDimensions = Object.values(model.dimensions).filter((dimension) =>
    perTerm.every(
      (entry) =>
        entry.candidates.filter((candidate) => candidate.dimension.id === dimension.id)
          .length === 1,
    ),
  );
  if (fittingDimensions.length === 1) {
    const dimension = fittingDimensions[0];
    const values = perTerm.map(
      (entry) =>
        entry.candidates.find((candidate) => candidate.dimension.id === dimension.id)!.value,
    );
    return {
      status: "ok",
      filter: {
        ...filter,
        field: dimension.id,
        value: filter.operator === "in" ? values : values[0],
      },
    };
  }
  const ambiguous =
    perTerm.find((entry) => entry.candidates.length > 1) ?? perTerm[0];
  return {
    status: "ambiguous_value",
    term: ambiguous.term,
    candidates: ambiguous.candidates,
  };
}

/**
 * Users say "since 2015", not "since 2015-01-01". Bare years and months are
 * well-defined date ranges, so they normalize deterministically; only truly
 * unparseable values are refused before SQL exists.
 */
function normalizeDateBound(raw: unknown, edge: "start" | "end"): string | undefined {
  const text = String(raw).trim();
  if (/^\d{4}$/.test(text)) return edge === "start" ? `${text}-01-01` : `${text}-12-31`;
  if (/^\d{4}-\d{2}$/.test(text)) {
    if (edge === "start") return `${text}-01`;
    const [year, month] = text.split("-").map(Number);
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${text}-${String(lastDay).padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return undefined;
}

function resolveTimeFilter(
  filter: AnalysisFilter,
  dimension: SemanticDimension,
): FilterResolution {
  const fail = (term: string): FilterResolution => ({ status: "unknown_value", term, dimension });
  switch (filter.operator) {
    case "gte":
    case "lte": {
      const edge = filter.operator === "gte" ? "start" : "end";
      const bound = normalizeDateBound(filter.value, edge);
      return bound ? { status: "ok", filter: { ...filter, value: bound } } : fail(String(filter.value));
    }
    case "between": {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) return fail(String(filter.value));
      const from = normalizeDateBound(filter.value[0], "start");
      const to = normalizeDateBound(filter.value[1], "end");
      return from && to
        ? { status: "ok", filter: { ...filter, value: [from, to] } }
        : fail(String(filter.value[0]));
    }
    case "equals": {
      // "in 2015" means the whole year, not one calendar day.
      const from = normalizeDateBound(filter.value, "start");
      const to = normalizeDateBound(filter.value, "end");
      if (!from || !to) return fail(String(filter.value));
      return from === to
        ? { status: "ok", filter: { ...filter, value: from } }
        : { status: "ok", filter: { ...filter, operator: "between", value: [from, to] } };
    }
    default:
      return { status: "ok", filter };
  }
}

function resolveFilter(filter: AnalysisFilter, model: SemanticModel): FilterResolution {
  const dimension = resolveEntry(filter.field, model.dimensions);
  if (!dimension) {
    return inferFieldFromValue(filter, model) ?? { status: "unknown_field" };
  }
  if (dimension.kind === "time") {
    return resolveTimeFilter({ ...filter, field: dimension.id }, dimension);
  }
  const resolved: AnalysisFilter = { ...filter, field: dimension.id };
  const validatable =
    dimension.kind === "category" &&
    dimension.values !== undefined &&
    (filter.operator === "equals" || filter.operator === "in");
  if (!validatable) return { status: "ok", filter: resolved };

  const terms = Array.isArray(filter.value) ? filter.value : [filter.value];
  const rewritten: string[] = [];
  for (const raw of terms) {
    if (typeof raw !== "string") return { status: "ok", filter: resolved };
    if (dimension.values!.includes(normalizedFilterValue(raw, dimension))) {
      rewritten.push(raw);
      continue;
    }
    const candidates = findValueCandidates(raw, model);
    if (candidates.length === 0) return { status: "unknown_value", term: raw, dimension };
    const sameDimension = candidates.filter(
      (candidate) => candidate.dimension.id === dimension.id,
    );
    // A single governed interpretation is a correction, not a guess. Inside an
    // `in` list it must stay in the same dimension — one filter cannot span two.
    if (candidates.length === 1 && filter.operator === "equals") {
      const only = candidates[0];
      return {
        status: "ok",
        filter: { ...resolved, field: only.dimension.id, value: only.value },
      };
    }
    if (sameDimension.length === 1 && filter.operator === "in") {
      rewritten.push(sameDimension[0].value);
      continue;
    }
    return { status: "ambiguous_value", term: raw, candidates };
  }
  return {
    status: "ok",
    filter: filter.operator === "in" ? { ...resolved, value: rewritten } : resolved,
  };
}

/** The "why not a raw average" sentence: the measure's own note when it has one, else a generic statement of the governed equivalent. */
function governedEquivalentSentence(measure: SemanticMeasure): string {
  return (
    measure.aggregationNote ??
    `The governed equivalent is “${measure.label}” (${measure.aggregation}).`
  );
}

/** Every measure-clarification option carries the exact next call, like filter/series clarifications already do. */
function measureClarificationOptions(model: SemanticModel) {
  return Object.values(model.measures).map((measure) => ({
    id: measure.id,
    label: measure.label,
    description: `${measure.description} Call inspectAnalysis again with measures ["${measure.id}"].`,
  }));
}

const ANALYSIS_LABELS: Record<AnalysisType, string> = {
  single_value: "One headline value",
  trend: "Change over ordered time",
  category_comparison: "Compare categories",
  detail: "Inspect exact rows",
  distribution: "How values are spread",
};

export function planAnalysis(draft: AnalysisDraft): AnalysisPlanResult {
  const model = getSemanticModel(draft.sourceId);
  if (!model) {
    return {
      status: "unsupported",
      reason: `Unknown semantic model “${draft.sourceId}”.`,
      suggestions: listSemanticModels().map((item) => item.id),
    };
  }

  if (!draft.analysisType) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "analysisType",
          question: "What should the figure help you understand?",
          options: (Object.keys(ANALYSIS_LABELS) as AnalysisType[]).map((id) => ({
            id,
            label: ANALYSIS_LABELS[id],
          })),
          recommended: "category_comparison",
          reason: "The analytical purpose determines the required data roles and chart policy.",
        },
      ],
    };
  }

  // Design §2: never silently guess a material analytical choice. An empty
  // measure list previously defaulted to the model's default measure — ask instead.
  if (draft.measures.length === 0) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "measures",
          question: "Which governed measure should the figure show?",
          options: Object.values(model.measures).map((measure) => ({
            id: measure.id,
            label: measure.label,
            description: measure.description,
          })),
          recommended: model.defaults.measure,
          reason: "The question did not name a measure, and defaults are only applied when you confirm them.",
        },
      ],
    };
  }

  // "price change" / "sales growth" is a base measure plus the query-time
  // comparison, not its own measure — resolving it that way is exact, so no
  // clarification is needed (measures stay plain aggregates).
  let comparison = draft.comparison;
  const measureTerms = draft.measures;
  const measures = measureTerms.map((term) => {
    const direct =
      resolveEntry(term, model.measures) ??
      // "latest median price" = the median measure; the recency word is a time
      // window, handled by the recency guard below in this same pass.
      resolveEntry(stripRecencyWords(term), model.measures);
    if (direct) return direct;
    const { base, hadChangeWord } = stripChangeWords(term);
    if (!hadChangeWord || base.length === 0) return undefined;
    const viaChange = resolveEntry(base, model.measures);
    if (viaChange) comparison = "vs_previous_period";
    return viaChange;
  });
  const missingMeasure = measureTerms.find((_, index) => !measures[index]);
  if (missingMeasure) {
    // Design §9.1: the aggregation is material. "average X" must not silently
    // resolve to a differently aggregated governed measure — surface the
    // governed equivalent and ask.
    const strippedAggregation = missingMeasure.replace(
      /^\s*(average|avg|mean|total|sum|maximum|max|minimum|min)\s+/i,
      "",
    );
    const aggregationBase = stripChangeWords(strippedAggregation);
    const lossyMatch =
      strippedAggregation !== missingMeasure
        ? (resolveEntry(strippedAggregation, model.measures) ??
          (aggregationBase.hadChangeWord
            ? resolveEntry(aggregationBase.base, model.measures)
            : undefined))
        : undefined;
    if (lossyMatch) {
      return {
        status: "needs_clarification",
        resolved: { ...draft },
        ambiguities: [
          {
            field: "measures",
            question: `“${missingMeasure}” is not a governed measure here. ${governedEquivalentSentence(
              lossyMatch,
            )} Use “${lossyMatch.label}”${
              aggregationBase.hadChangeWord ? ' with comparison "vs_previous_period"' : ""
            } instead?`,
            options: measureClarificationOptions(model),
            recommended: lossyMatch.id,
            reason: "Changing the aggregation changes the business meaning, so it needs confirmation.",
          },
        ],
      };
    }
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "measures",
          question: `Which governed measure should replace “${missingMeasure}”?`,
          options: measureClarificationOptions(model),
          recommended: suggestEntry(missingMeasure, model.measures)?.id ?? model.defaults.measure,
          reason: "Only measures defined by the semantic layer can be queried.",
        },
      ],
    };
  }

  // The model can rewrite user wording into a governed synonym before this
  // tool ever sees it — "average prices" arrives as measures: ["prices"],
  // which resolves straight through (it's median_price's own synonym), so
  // the lossy-aggregation check above never fires on an unresolved term. The
  // recency guard further below uses this exact pattern: check draft.question
  // deterministically, since prompt wording can't be trusted to self-report.
  // Verbatim governed ids are the user-confirmed escape hatch — otherwise a
  // clarification answered with the exact id would loop forever.
  const measuresAreVerbatimIds = draft.measures.every((term) => term in model.measures);
  const firstMeasure = measures[0]!;
  if (
    AVERAGE_WORDS.test(draft.question) &&
    !measuresAreVerbatimIds &&
    !/\b(avg|mean)\b/i.test(firstMeasure.aggregation)
  ) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "measures",
          question: `${governedEquivalentSentence(firstMeasure)} Use “${firstMeasure.label}” instead?`,
          options: measureClarificationOptions(model),
          recommended: firstMeasure.id,
          reason: "Changing the aggregation changes the business meaning, so it needs confirmation.",
        },
      ],
    };
  }

  // A distribution bins the raw per-row values of a single measure over one
  // population — there is no per-row value for a count, and no grouping
  // dimension to bin against (that would be several distributions, not one).
  if (draft.analysisType === "distribution") {
    if (measures.length !== 1) {
      return {
        status: "unsupported",
        reason: "A distribution requires exactly one measure to bin.",
        suggestions: Object.values(model.measures)
          .filter((measure) => measure.valueExpression)
          .map((measure) => measure.id),
      };
    }
    const [measure] = measures;
    if (!measure!.valueExpression) {
      return {
        status: "unsupported",
        reason: `“${measure!.label}” has no per-row value to bin — it has no valueExpression in the semantic model.`,
        suggestions: Object.values(model.measures)
          .filter((candidate) => candidate.valueExpression)
          .map((candidate) => candidate.label),
      };
    }
  }

  let dimensions = draft.dimensions.map((field) => resolveField(field, model));
  const missingDimension = draft.dimensions.find((_, index) => !dimensions[index]);
  if (missingDimension) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "dimensions",
          question: `Which governed dimension should replace “${missingDimension.field}”?`,
          options: Object.values(model.dimensions).map((dimension) => ({
            id: dimension.id,
            label: dimension.label,
            description: dimension.description,
          })),
          recommended:
            suggestEntry(missingDimension.field, model.dimensions)?.id ??
            model.defaults.timeDimension ??
            Object.keys(model.dimensions)[0],
          reason: "Only dimensions and grains supported by the source can be selected.",
        },
      ],
    };
  }

  if (draft.analysisType === "distribution" && dimensions.length > 0) {
    return {
      status: "unsupported",
      reason: "A distribution shows one population; use filters to scope it instead of dimensions.",
      suggestions: ["Remove the dimension and add an equivalent filter instead."],
    };
  }

  if (draft.analysisType === "trend" && !dimensions.some((field) => {
    const dimension = field && model.dimensions[field.field];
    return dimension?.kind === "time";
  })) {
    const timeId = model.defaults.timeDimension;
    if (!timeId) {
      return {
        status: "unsupported",
        reason: "This semantic model has no time dimension for a trend.",
        suggestions: ["Use a category comparison or table instead."],
      };
    }
    dimensions = [
      { field: timeId, grain: model.defaults.timeGrain },
      ...dimensions,
    ];
  }

  // The one temporal rule left: a change versus the previous period is
  // undefined without ordered periods (design §15.2, reduced to its essence).
  const hasTimeDimension = dimensions.some(
    (field) => field && model.dimensions[field.field]?.kind === "time",
  );
  if (comparison && !hasTimeDimension) {
    return {
      status: "unsupported",
      reason:
        "A change versus the previous period needs a time dimension. Ask for a trend over time, or drop the change.",
      suggestions: ["Re-draft with analysisType \"trend\"."],
    };
  }

  if (
    draft.analysisType === "category_comparison" &&
    !dimensions.some((field) => field && model.dimensions[field.field]?.kind === "category")
  ) {
    const categoryOptions = Object.values(model.dimensions)
      .filter((dimension) => dimension.kind === "category")
      .map((dimension) => ({ id: dimension.id, label: dimension.label }));
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "dimensions",
          question: "Which category should be compared?",
          options: categoryOptions,
          recommended: categoryOptions[0]!.id,
          reason: "A category comparison requires one governed categorical dimension.",
        },
      ],
    };
  }

  const filterResolutions = draft.filters.map((filter) => resolveFilter(filter, model));
  const missingFilter = draft.filters.find(
    (_, index) => filterResolutions[index].status === "unknown_field",
  );
  if (missingFilter) {
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "filters",
          question: `Which governed field should “${missingFilter.field}” filter?`,
          options: Object.values(model.dimensions).map((dimension) => ({
            id: dimension.id,
            label: dimension.label,
          })),
          recommended:
            suggestEntry(missingFilter.field, model.dimensions)?.id ??
            Object.keys(model.dimensions)[0],
          reason: "Filters must resolve to governed dimensions before SQL is compiled.",
        },
      ],
    };
  }
  for (const resolution of filterResolutions) {
    if (resolution.status === "ambiguous_value") {
      return {
        status: "needs_clarification",
        resolved: { ...draft },
        ambiguities: [
          {
            field: "filters",
            question: `“${resolution.term}” matches more than one governed value. Which population should the filter select?`,
            options: resolution.candidates.slice(0, 8).map((candidate) => ({
              id: `${candidate.dimension.id}=${candidate.value}`,
              label: `${candidate.value} (${candidate.dimension.label})`,
              description: `Call inspectAnalysis again filtering ${candidate.dimension.id} equals "${candidate.value}".`,
            })),
            recommended: `${resolution.candidates[0].dimension.id}=${resolution.candidates[0].value}`,
            reason:
              "The same term appears in several governed dimensions, and each choice selects a materially different population.",
          },
        ],
      };
    }
    if (resolution.status === "unknown_value") {
      const nearestValues = suggestValues(resolution.term, resolution.dimension);
      return {
        status: "unsupported",
        reason: `No governed ${resolution.dimension.label} value matches “${resolution.term}”.`,
        suggestions: [
          ...(nearestValues.length > 0 ? [`Did you mean "${nearestValues[0]}"?`] : []),
          "Check the spelling, or ask what values exist for this dimension.",
        ],
      };
    }
  }
  const filters = filterResolutions.map(
    (resolution) => (resolution as Extract<FilterResolution, { status: "ok" }>).filter,
  );

  // "Latest/current/recent" is a time window, not a measure. On a snapshot
  // question (no displayed time dimension) with no time filter pinning the
  // window, the choice materially changes the population — ask, with options
  // anchored to the source's actual freshness (design §9.1 "time range").
  // Deterministic on purpose: prompt wording cannot be trusted to catch this.
  const recency = /\b(latest|current|recent|newest|now|nowadays|today)\b/i;
  const timeDimensionId = model.defaults.timeDimension;
  const hasTimeBound = filters.some(
    (filter) =>
      filter.field === timeDimensionId &&
      (filter.operator === "gte" || filter.operator === "lte" || filter.operator === "between"),
  );
  if (
    timeDimensionId &&
    !hasTimeDimension &&
    !hasTimeBound &&
    (recency.test(draft.question) || draft.measures.some((term) => recency.test(term)))
  ) {
    const [year, month, day] = model.lastRefresh.split("-");
    const trailingStart = `${Number(year) - 1}-${month}-${day}`;
    const lastFullYear = String(Number(year) - 1);
    const allTimeStart = model.availableRange?.[0] ?? "1900-01-01";
    return {
      status: "needs_clarification",
      resolved: { ...draft },
      ambiguities: [
        {
          field: "filters",
          question: `“Latest” needs a governed time window — the data ends ${model.lastRefresh}. Which window should be used?`,
          options: [
            {
              id: "trailing_12_months",
              label: `Trailing 12 months (${trailingStart} → ${model.lastRefresh})`,
              description: `Call inspectAnalysis again with filter ${timeDimensionId} gte "${trailingStart}".`,
            },
            {
              id: "latest_full_year",
              label: `Latest full year (${lastFullYear})`,
              description: `Call inspectAnalysis again with filter ${timeDimensionId} equals "${lastFullYear}".`,
            },
            {
              id: "all_time",
              label: `All records (since ${allTimeStart})`,
              description: `Call inspectAnalysis again with filter ${timeDimensionId} gte "${allTimeStart}".`,
            },
          ],
          recommended: "trailing_12_months",
          reason:
            "Without an explicit window, “latest” would silently become an all-time aggregate.",
        },
      ],
    };
  }

  // Design §5.4/§9.1: consult capability metadata BEFORE querying. A trend
  // over a wide category must not run, hit the row cap, and dead-end — it asks
  // for a supported series scope instead.
  const categoryField = dimensions.find(
    (field) => field && model.dimensions[field.field]?.kind === "category",
  );
  let seriesSelection: (SeriesSelection & { by: string }) | undefined;
  if (draft.analysisType === "trend" && categoryField) {
    const dimension = model.dimensions[categoryField.field];
    const scopeFilter = filters.find((filter) => filter?.field === dimension.id);
    const estimatedSeries =
      scopeFilter?.operator === "equals"
        ? 1
        : scopeFilter?.operator === "in" && Array.isArray(scopeFilter.value)
          ? scopeFilter.value.length
          : (dimension.cardinality ?? 0);

    if (draft.seriesSelection) {
      const rankTerm =
        draft.seriesSelection.by ?? model.defaults.seriesRankMeasure ?? measures[0]!.id;
      const rankMeasure = resolveEntry(rankTerm, model.measures);
      if (!rankMeasure) {
        return {
          status: "unsupported",
          reason: `The series-ranking measure “${rankTerm}” is not in the semantic model.`,
          suggestions: Object.keys(model.measures),
        };
      }
      seriesSelection = {
        method: "top",
        n: Math.min(Math.max(draft.seriesSelection.n, 1), MAX_LINE_SERIES),
        by: rankMeasure.id,
      };
    } else if (estimatedSeries > MAX_LINE_SERIES) {
      const rankLabel =
        resolveEntry(model.defaults.seriesRankMeasure ?? measures[0]!.id, model.measures)
          ?.label ?? measures[0]!.label;
      return {
        status: "needs_clarification",
        resolved: { ...draft },
        ambiguities: [
          {
            field: "seriesSelection",
            question: `Up to ${estimatedSeries} ${dimension.label.toLowerCase()} values match, but one readable line chart supports at most ${MAX_LINE_SERIES} series. How should the scope be narrowed?`,
            options: [
              {
                id: "top_series",
                label: `Top ${MAX_LINE_SERIES} by ${rankLabel.toLowerCase()}`,
                description: `Call inspectAnalysis again with seriesSelection { "method": "top", "n": ${MAX_LINE_SERIES} }.`,
              },
              {
                id: "switch_to_comparison",
                label: `Compare ${dimension.label.toLowerCase()} values at one point in time instead`,
                description:
                  "Call inspectAnalysis again as a category_comparison without the time dimension.",
              },
            ],
            recommended: "top_series",
            reason:
              "Silent truncation is forbidden, so the series scope is a user choice (figure policy, series limit).",
          },
        ],
      };
    }
  }

  const orderBy = draft.orderBy.map((order) => {
    const measure = resolveEntry(order.field, model.measures);
    const dimension = resolveEntry(order.field, model.dimensions);
    return measure || dimension ? { ...order, field: (measure ?? dimension)!.id } : undefined;
  });
  if (orderBy.some((order) => !order)) {
    return {
      status: "unsupported",
      reason: "The requested sort field is not in the semantic model.",
      suggestions: [...Object.keys(model.dimensions), ...Object.keys(model.measures)],
    };
  }

  const request = {
    ...draft,
    analysisType: draft.analysisType,
    measures: measures.map((measure) => measure!.id),
    dimensions: dimensions.map((dimension) => dimension!),
    filters,
    orderBy: orderBy.map((order) => order!),
    seriesSelection,
    comparison,
  };
  const figure = selectProvisionalFigure(request, model);
  if (figure.status !== "selected") {
    return { status: "unsupported", reason: figure.reason, suggestions: figure.suggestions };
  }

  return {
    status: "ready",
    request,
    figure: figure.kind,
    figureReason: figure.reason,
    figureAlternatives: figure.alternatives,
  };
}

/**
 * Answers "how did you calculate X?" from the semantic layer alone — no SQL
 * runs. The governed definition, aggregation, expression, provenance, and
 * limitations already exist in the model; this just renders them as a tile.
 */
export function explainSemanticTerm(sourceId: string, term: string): ViewSpec {
  const model = getSemanticModel(sourceId);
  if (!model) {
    return {
      kind: "notice",
      title: "Unknown data source",
      message: `No semantic model is registered as “${sourceId}”.`,
      tone: "warning",
      suggestions: listSemanticModels().map((item) => item.id),
    };
  }

  const stripped = stripRecencyWords(term);
  const measure =
    resolveEntry(term, model.measures) ?? resolveEntry(stripped, model.measures);
  if (measure) {
    const recencyNote =
      stripped !== term.trim()
        ? " Words like “latest” are not part of the measure — they become a governed date filter chosen per question."
        : "";
    return {
      kind: "notice",
      title: `How “${measure.label}” is calculated`,
      message:
        `${measure.description} Aggregation: ${measure.aggregation}. ` +
        `SQL expression: ${measure.expression}. ` +
        `Definition version ${measure.version}; source ${model.sourceSystem}, refreshed ${model.lastRefresh}.` +
        recencyNote,
      tone: "neutral",
      suggestions: measure.limitations,
    };
  }

  const dimension = resolveEntry(term, model.dimensions);
  if (dimension) {
    return {
      kind: "notice",
      title: `What “${dimension.label}” means`,
      message:
        `${dimension.description} Kind: ${dimension.kind}. ` +
        (dimension.values
          ? `${dimension.values.length} governed values snapshotted from the source. `
          : "") +
        (dimension.grains
          ? `Supported grains: ${Object.keys(dimension.grains).join(", ")}.`
          : ""),
      tone: "neutral",
      suggestions: [],
    };
  }

  return {
    kind: "notice",
    title: `“${term}” is not a governed concept`,
    message: "Only measures and dimensions defined in the semantic layer can be explained.",
    tone: "warning",
    suggestions: [
      ...Object.values(model.measures).map((item) => item.label),
      ...Object.values(model.dimensions).map((item) => item.label),
    ],
  };
}

const CATALOG_EXAMPLE_VALUES = 3;

function describeDimensionDetails(dimension: SemanticDimension, model: SemanticModel): string {
  if (dimension.kind === "time") {
    const grains = dimension.grains ? `Grains: ${Object.keys(dimension.grains).join(", ")}.` : "";
    const range = model.availableRange
      ? ` Available ${model.availableRange[0]} → ${model.availableRange[1]}.`
      : "";
    return `${grains}${range}`;
  }
  const examples = dimension.values
    ?.slice(0, CATALOG_EXAMPLE_VALUES)
    .join(", ");
  return `${dimension.cardinality ?? dimension.values?.length ?? "?"} governed values${
    examples ? `, e.g. ${examples}` : ""
  }.`;
}

/**
 * Answers "what data do you have / what can I ask?" as a catalog tile, read
 * from the semantic model alone — no SQL runs. Everything on it (row scale,
 * range, refresh) was snapshotted at onboarding, so it costs nothing and can
 * never disagree with governance.
 */
export function describeDataSource(sourceId: string): ViewSpec {
  const model = getSemanticModel(sourceId);
  if (!model) {
    return {
      kind: "notice",
      title: "Unknown data source",
      message: `No semantic model is registered as “${sourceId}”.`,
      tone: "warning",
      suggestions: listSemanticModels().map((item) => item.id),
    };
  }

  const measureRows = Object.values(model.measures).map((measure) => ({
    name: measure.label,
    role: "measure",
    description: measure.description,
    details: `Aggregation: ${measure.aggregation}.`,
  }));
  const dimensionRows = Object.values(model.dimensions).map((dimension) => ({
    name: dimension.label,
    role: "dimension",
    description: dimension.description,
    details: describeDimensionDetails(dimension, model),
  }));

  const scope = [
    `Source: ${model.sourceSystem}`,
    ...(model.rowScale ? [model.rowScale] : []),
    ...(model.availableRange
      ? [`Covers ${model.availableRange[0]} → ${model.availableRange[1]}`]
      : []),
    `Last refresh: ${model.lastRefresh}`,
  ];

  return {
    kind: "table",
    title: `${model.label} — what you can ask`,
    columns: [
      { key: "name", label: "Name" },
      { key: "role", label: "Role" },
      { key: "description", label: "Description" },
      { key: "details", label: "Details" },
    ],
    rows: [...measureRows, ...dimensionRows],
    // Honest zeros: the catalog is a registry read, so no rows were scanned.
    stats: { rowsRead: 0, elapsedMs: 0 },
    explanation: {
      whatShown: "The governed catalog: every measure and dimension this source can answer with.",
      calculation: "Read from the semantic model registry; no query ran.",
      scope,
      provenance: {
        semanticModel: model.label,
        source: model.sourceSystem,
        lastRefresh: model.lastRefresh,
        modelVersion: model.version,
        measureVersions: Object.values(model.measures).map(
          (measure) => `${measure.id}@${measure.version}`,
        ),
        figurePolicyVersion: model.figurePolicyVersion,
      },
      limitations: [
        "Only questions expressible in these measures and dimensions are supported.",
      ],
      inspect: {
        semanticQuery: JSON.stringify({ sourceId: model.id, catalog: true }, null, 2),
        generatedSql: "-- no SQL: the catalog is read from the semantic model, not the database",
      },
    },
  };
}
