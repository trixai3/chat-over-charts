import type { ValueFormat } from "./view-spec";

export function formatValue(value: number, format: ValueFormat): string {
  switch (format.style) {
    case "currency":
      return new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: format.currency,
        maximumFractionDigits: 0,
      }).format(value);
    case "number":
      return new Intl.NumberFormat("en-GB", {
        maximumFractionDigits: format.maximumFractionDigits,
      }).format(value);
    case "percent":
      return `${value.toFixed(format.maximumFractionDigits)}%`;
  }
}

export function formatDelta(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
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
