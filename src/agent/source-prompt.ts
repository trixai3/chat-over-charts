import type { SemanticModel } from "../analysis/types";
import { measureId } from "../analysis/measure-grammar";

/**
 * Renders the per-source vocabulary block the model reads alongside the
 * generic system prompt. Everything here comes from the bound model's own
 * data (labels, synonyms, notes, hints) — this file names no measure or
 * dimension of its own, so a new source pack teaches the model just by
 * registering, with no change to core agent code (AGENTS.md invariant: the
 * LLM's static surface stays source-neutral).
 */
export function sourcePromptCatalog(model: SemanticModel): string {
  const lines: string[] = [];

  lines.push(`The connected source is ${model.label} (${model.sourceSystem}).`);

  const valueFields = Object.values(model.valueFields ?? {});

  // Value-field aggregations grouped by field, not flattened, so the
  // intent-to-aggregation mapping ("affordable" -> p25, "top" -> p90) reads as
  // one menu per field rather than scattered across unrelated measures.
  for (const field of valueFields) {
    const menu = field.aggregations
      .map((aggregation) => `${aggregation.kind} = ${aggregation.label} (${aggregation.synonyms.join(", ")})`)
      .join("; ");
    lines.push(
      `${field.label} wording states an intent — compose the measure as {field: "${field.id}", ` +
        `aggregation}: ${menu}.`,
    );
  }

  // Measures not backed by a value field (e.g. a plain count) aren't part of
  // any composed-aggregation menu, so they're listed directly by label.
  const composedIds = new Set(
    valueFields.flatMap((field) => field.aggregations.map((aggregation) => measureId(field, aggregation.kind))),
  );
  const standalone = Object.values(model.measures).filter((measure) => !composedIds.has(measure.id));
  if (standalone.length > 0) {
    const entries = standalone
      .map((measure) =>
        measure.synonyms.length > 0 ? `${measure.label} (also: ${measure.synonyms.join(", ")})` : measure.label,
      )
      .join("; ");
    lines.push(`Other measures this source can show: ${entries}.`);
  }

  // The "why this aggregation, not the mean" rule — each value field owns its
  // own note, deduped since every generated measure of a field inherits it.
  const distributionNotes = new Set(valueFields.map((field) => field.distributionNote).filter(Boolean));
  for (const note of distributionNotes) lines.push(note);

  if ((model.memberResolvers ?? []).length > 0) {
    lines.push(
      "Some value names match several governed members; when inspectAnalysis returns options, " +
        "relay them via requestClarification and never pick one yourself.",
    );
  }

  for (const hint of model.promptHints ?? []) lines.push(hint);

  return lines.join(" ");
}
