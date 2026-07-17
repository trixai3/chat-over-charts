import type { Unit } from "./view-spec";

const gbp = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});
const count = new Intl.NumberFormat("en-GB");

export function formatValue(v: number, unit: Unit): string {
  switch (unit) {
    case "gbp":
      return gbp.format(v);
    case "count":
      return count.format(v);
    case "pct":
      return `${v.toFixed(1)}%`;
  }
}

/** Deltas always carry an explicit sign — "+18%" and "18%" read differently. */
export function formatDelta(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export function formatStats(rowsRead: number, elapsedMs: number): string {
  const rows =
    rowsRead >= 1_000_000
      ? `${(rowsRead / 1_000_000).toFixed(1)}M`
      : rowsRead >= 1_000
        ? `${(rowsRead / 1_000).toFixed(0)}k`
        : `${rowsRead}`;
  return `${rows} rows · ${elapsedMs.toFixed(0)}ms`;
}
