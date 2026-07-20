import type {
  AggregationKind,
  ComposedMeasure,
  SemanticMeasure,
  SemanticModel,
  SemanticValueField,
} from "./types";

/**
 * The only place aggregation SQL exists. The model picks a kind from the
 * closed enum; this table turns it into a vetted expression — so composing
 * "p90 of price" never involves the LLM holding SQL (AGENTS.md invariant 5).
 */
const AGGREGATION_SQL: Record<AggregationKind, (value: string) => string> = {
  median: (value) => `round(quantileTDigest(0.5)(${value}))`,
  p25: (value) => `round(quantileTDigest(0.25)(${value}))`,
  p75: (value) => `round(quantileTDigest(0.75)(${value}))`,
  p90: (value) => `round(quantileTDigest(0.9)(${value}))`,
  max: (value) => `max(${value})`,
};

/** Human-readable aggregation names, used for explanations and the average-word guard. */
const AGGREGATION_NAME: Record<AggregationKind, string> = {
  median: "quantileTDigest median",
  p25: "quantileTDigest 25th percentile",
  p75: "quantileTDigest 75th percentile",
  p90: "quantileTDigest 90th percentile",
  max: "max",
};

export const AGGREGATION_KINDS = ["median", "p25", "p75", "p90", "max"] as const;

export function measureId(field: SemanticValueField, kind: AggregationKind): string {
  return `${kind}_${field.id}`;
}

/**
 * Expands a value field's vetted menu into concrete governed measures. The
 * default aggregation inherits the field's own synonyms ("price" alone means
 * the median), so bare-field wording keeps resolving without clarification.
 */
export function buildMeasures(field: SemanticValueField): Record<string, SemanticMeasure> {
  const measures: Record<string, SemanticMeasure> = {};
  for (const aggregation of field.aggregations) {
    const id = measureId(field, aggregation.kind);
    measures[id] = {
      id,
      label: aggregation.label,
      description: aggregation.description,
      expression: AGGREGATION_SQL[aggregation.kind](field.valueExpression),
      format: field.format,
      aggregation: AGGREGATION_NAME[aggregation.kind],
      version: field.version,
      synonyms:
        aggregation.kind === field.defaultAggregation
          ? [...aggregation.synonyms, ...field.synonyms]
          : aggregation.synonyms,
      limitations: [...field.limitations, ...(aggregation.caveat ? [aggregation.caveat] : [])],
      aggregationNote: field.distributionNote,
      valueExpression: field.valueExpression,
    };
  }
  return measures;
}

export type ComposedResolution =
  | { status: "ok"; measure: SemanticMeasure }
  | { status: "unknown_field" }
  | { status: "unvetted_aggregation"; field: SemanticValueField };

/**
 * Resolves a model-composed {field, aggregation} pair against the grammar.
 * The field matches by id or synonym; the aggregation must be on that field's
 * vetted menu. Anything else is a clarification, exactly like an unknown
 * string term — composition widens the vocabulary, never the guardrail.
 */
export function resolveComposedMeasure(
  composed: ComposedMeasure,
  model: SemanticModel,
): ComposedResolution {
  const target = composed.field.trim().toLowerCase();
  const field = Object.values(model.valueFields ?? {}).find(
    (candidate) =>
      candidate.id === target ||
      candidate.synonyms.some((synonym) => synonym.toLowerCase() === target),
  );
  if (!field) return { status: "unknown_field" };
  const vetted = field.aggregations.some((aggregation) => aggregation.kind === composed.aggregation);
  if (!vetted) return { status: "unvetted_aggregation", field };
  return { status: "ok", measure: model.measures[measureId(field, composed.aggregation)] };
}

/** Display form of a composed term for clarification questions. */
export function composedLabel(composed: ComposedMeasure): string {
  return `${composed.aggregation} of ${composed.field}`;
}
