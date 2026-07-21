"use client";

import type { ViewSpec } from "@/shared/view-spec";
import { formatDelta, formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "comparison" }>;

/**
 * The demo's centrepiece: Havering +18% next to Lambeth -7% is the contrast a
 * paragraph destroys. Bars are drawn as plain divs — no chart library, because
 * the shapes we need are simple and third-party libs are the usual source of
 * hydration bugs.
 */
export function ComparisonTile({ spec }: { spec: Spec }) {
  const max = Math.max(...spec.rows.map((r) => r.value));

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between font-mono text-[11px] text-black/35 dark:text-white/35">
          <span>{spec.metricLabel}</span>
          <span>{spec.comparisonLabel ?? ""}</span>
        </div>

        {spec.rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[7rem_1fr_5rem_4rem] items-center gap-3 px-1 py-1"
          >
            <span className="truncate text-xs font-medium">{row.label}</span>

            {/* Meter spec: the unfilled track is a lighter step of the fill's own
                ramp, so the bar reads as one object at two states, not two bars. */}
            <span className="h-4 rounded-[4px] bg-[var(--series-1-track)]">
              <span
                className="chart-meter block h-full rounded-r-[4px] bg-[var(--series-1)] transition-[width]"
                style={{ width: `${(row.value / max) * 100}%` }}
              />
            </span>

            <span className="text-right font-mono text-xs tabular-nums">
              {formatValue(row.value, spec.format)}
            </span>

            <span
              className="text-right font-mono text-xs tabular-nums"
              style={{
                color:
                  row.delta === undefined
                    ? "var(--chart-muted)"
                    : row.delta > 0
                      ? "var(--delta-up)"
                      : "var(--delta-down)",
              }}
            >
              {row.delta === undefined ? "—" : formatDelta(row.delta)}
            </span>
          </div>
        ))}
      </div>
    </TileFrame>
  );
}
