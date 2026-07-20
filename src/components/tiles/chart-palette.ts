/**
 * Categorical color assignment for every tile. Slots are a fixed, CVD-validated
 * order defined in globals.css — hue follows the series position, never cycles:
 * a 9th series gets the neutral "other" gray instead of reusing slot 1, because
 * two series sharing a hue is a lie the legend can't undo.
 */
const SERIES_LIMIT = 8;

export function seriesColor(index: number): string {
  return index < SERIES_LIMIT ? `var(--series-${index + 1})` : "var(--series-other)";
}
