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

/**
 * Axis-label formatter inferred from the whole time domain, so one axis never
 * mixes grains: all year-starts → "1995"; all month-starts → "1995-03";
 * anything else stays a full date. Grain is inferred from the values rather
 * than carried on the spec — the ISO strings already encode it.
 */
export function timeLabelFormatter(times: string[]): (t: string) => string {
  if (times.length > 0 && times.every((t) => /^\d{4}-01-01$/.test(t))) {
    return (t) => t.slice(0, 4);
  }
  if (times.length > 0 && times.every((t) => /^\d{4}-\d{2}-01$/.test(t))) {
    return (t) => t.slice(0, 7);
  }
  return (t) => t;
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
