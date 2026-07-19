/**
 * The metrics registry. One place defines what a "price" means in SQL, so no
 * tool can quietly reintroduce the wrong statistic.
 *
 * Metrics are MEDIANS, never averages. UK house prices are heavily
 * right-skewed — a handful of £10M sales drag `avg(price)` far above what a
 * normal buyer faces. `quantileTDigest(0.5)` is the honest number. Defining it
 * here, once, is the guardrail (AGENTS.md conventions).
 */

/**
 * Median `price` over the rows matching `cond` (a ClickHouse boolean expr).
 * The `-If` combinator lets us compute two period medians in one scan, which is
 * how compareAreas gets both the latest median and the 5-years-ago baseline
 * without a self-join.
 */
export function medianPriceIf(cond: string): string {
  return `round(quantileTDigestIf(0.5)(price, ${cond}))`;
}

/**
 * The two windows behind "5-year growth", written relative to the query date so
 * they self-update as new months load. `today()` runs in ClickHouse; the
 * offline test never evaluates these (its fake client ignores the SQL text).
 *
 *   LATEST   — trailing ~12 months (the data currently ends 2026-05-29)
 *   BASELINE — the 12 months ending 5 years ago
 */
export const LATEST_WINDOW = "date >= today() - INTERVAL 1 YEAR";
export const BASELINE_WINDOW =
  "date >= today() - INTERVAL 6 YEAR AND date < today() - INTERVAL 5 YEAR";

/**
 * The thin geography for slice 2: we only ever break a county down into its
 * districts. The full geo tree (arbitrary-level drill-down) is Day 4 — this is
 * the deliberately minimal version that unblocks the first real tool.
 */
export const GROUP_LEVEL = "district" as const;
export const PARENT_LEVEL = "county" as const;
