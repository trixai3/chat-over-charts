import { tool } from "ai";
import { z } from "zod";
import type { QueryStats, ViewSpec } from "../shared/view-spec";
import { getClickHouse } from "../shared/clickhouse";
import { BASELINE_WINDOW, LATEST_WINDOW, medianPriceIf } from "./metrics";

/**
 * The agent's tools. The uniform contract here: **every tool's output IS a
 * ViewSpec** — the exact object the frontend renders. That keeps the frontend
 * dumb (it validates `part.output` once and renders) and lets each tool carry
 * its own `toModelOutput` to compress what the *model* sees down to one line.
 *
 * Two different consumers of one tool result:
 *   - execute()'s return value  → streamed to the frontend as the tile
 *   - toModelOutput()'s return  → what re-enters the model's prompt next step
 * The split is the whole point (AGENTS.md invariant 2): rendering data to the
 * frontend, decision data to the model.
 */

/** One row of the compareAreas query — a district and its two period medians. */
type DistrictRow = {
  district: string;
  latest_median: number;
  base_median: number;
  n: number;
};

function parseStats(header: unknown): QueryStats {
  try {
    const s = JSON.parse(String(header ?? "{}")) as Record<string, string>;
    return {
      rowsRead: Number(s.read_rows ?? 0),
      elapsedMs: Math.round(Number(s.elapsed_ns ?? 0) / 1e6),
    };
  } catch {
    return { rowsRead: 0, elapsedMs: 0 };
  }
}

/**
 * Break a county into its districts, ranked by 5-year price growth or by latest
 * median price. This is the first tool that touches the 31M-row table. The
 * model picks the tool and fills `county`; our code writes the SQL (AGENTS.md
 * invariant 5 — the LLM never writes SQL).
 *
 * NOTE: `county` must be a full county name (e.g. "Greater London"), which we
 * uppercase to hit the primary-key index exactly. Fuzzy place resolution
 * ("London" → "GREATER LONDON", "Clapham" → the disambiguation tile) is Day 3;
 * this tool assumes a resolved county.
 */
export const compareAreas = tool({
  description:
    "Break a county into its districts, ranked by 5-year median-price growth or " +
    "by latest median price. Use for 'which area rose fastest / is cheapest' " +
    "questions. Pass a full county name, e.g. 'Greater London', 'West Midlands'.",
  inputSchema: z.object({
    county: z
      .string()
      .describe("Full county name to break down by district, e.g. 'Greater London'."),
    orderBy: z
      .enum(["growth", "price"])
      .default("growth")
      .describe("Rank by 5-year growth (fastest first) or by median price (cheapest first)."),
    limit: z.number().int().min(1).max(20).default(8),
  }),
  execute: async ({ county, orderBy, limit }): Promise<ViewSpec> => {
    // Uppercase so `county = {param}` matches the LowCardinality values exactly
    // and prunes on the primary key. A case-insensitive `upper(county)=...`
    // would defeat the index and scan all 31M rows.
    const countyKey = county.toUpperCase();

    // orderBy is a closed enum, never interpolated user text — safe to embed.
    const orderExpr =
      orderBy === "growth"
        ? "(latest_median - base_median) / base_median DESC"
        : "latest_median ASC";

    const query = `
      SELECT
        district,
        ${medianPriceIf(LATEST_WINDOW)} AS latest_median,
        ${medianPriceIf(BASELINE_WINDOW)} AS base_median,
        count() AS n
      FROM {db:Identifier}.sales
      WHERE county = {county:String}
      GROUP BY district
      HAVING base_median > 0 AND countIf(${LATEST_WINDOW}) > 50
      ORDER BY ${orderExpr}
      LIMIT {limit:UInt32}
    `;

    const rs = await getClickHouse().query({
      query,
      query_params: {
        db: process.env.CLICKHOUSE_DATABASE ?? "HACK_BWT",
        county: countyKey,
        limit,
      },
      format: "JSONEachRow",
    });
    const rows = (await rs.json()) as DistrictRow[];
    const stats = parseStats(rs.response_headers?.["x-clickhouse-summary"]);

    return {
      kind: "comparison",
      title: `Districts of ${county} — 5-year change`,
      metricLabel: "Median price",
      unit: "gbp",
      rows: rows.map((r) => ({
        label: r.district,
        value: r.latest_median,
        delta: Math.round(((r.latest_median - r.base_median) / r.base_median) * 1000) / 10,
        drill: { label: r.district, level: "district", value: r.district },
      })),
      stats,
    };
  },
  // The frontend gets the whole ComparisonSpec above; the MODEL gets this one
  // line. This is the invariant-3 payoff: a raw ComparisonSpec re-entering the
  // prompt every turn would bloat the context and the cache prefix. The summary
  // deliberately carries NO spec field names (kind/metricLabel/drill) — decision
  // data only, so the turn-2 test can prove the raw JSON never leaked.
  toModelOutput: ({ output }) => {
    const spec = output as Extract<ViewSpec, { kind: "comparison" }>;
    const top = spec.rows[0];
    const summary = top
      ? `Compared ${spec.rows.length} districts. Top: ${top.label} (median £${top.value.toLocaleString("en-GB")}, ${top.delta}% 5yr). Scanned ${spec.stats.rowsRead.toLocaleString("en-GB")} rows in ${spec.stats.elapsedMs}ms.`
      : "No districts matched.";
    return { type: "text", value: summary };
  },
});

/**
 * The only way the agent is allowed to answer. There is no prose channel: a
 * system prompt saying "don't write paragraphs" is a request the model can
 * ignore; making the verdict a *tool* leaves it no other exit (AGENTS.md
 * invariant 1). The model authors the words, but they land inside a tone-tagged
 * tile, not as loose chat text.
 */
export const emitVerdict = tool({
  description:
    "Deliver the final answer as a one-line verdict tile. This is the ONLY way " +
    "to respond to the user — never write a prose reply. Call it exactly once, " +
    "last, after any data tools have run.",
  inputSchema: z.object({
    headline: z
      .string()
      .describe("The answer in one line, e.g. 'Havering rose fastest: +17.9% over 5 years.'"),
    detail: z
      .string()
      .optional()
      .describe("One short sentence of supporting context. Optional."),
    tone: z
      .enum(["good", "bad", "neutral"])
      .describe("Sentiment colour for the tile: good (green), bad (red), neutral."),
  }),
  // Our code assembles the spec; the model only filled the params. The output
  // type is the VerdictSpec variant of ViewSpec, so the frontend renders it
  // with zero branching.
  execute: async ({ headline, detail, tone }): Promise<ViewSpec> => ({
    kind: "verdict",
    headline,
    detail,
    tone,
  }),
  // The model wrote these words itself — echoing the full tile back into its
  // context on the next step buys nothing and bloats the cache prefix. Collapse
  // it to a one-line acknowledgement. This is the cheap demonstration of the
  // mechanism that compareAreas will lean on hard in slice 2.
  toModelOutput: () => ({
    type: "text",
    value: "Verdict delivered to the user.",
  }),
});
