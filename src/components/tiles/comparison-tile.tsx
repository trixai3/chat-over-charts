"use client";

import type { DrillTarget, ViewSpec } from "@/shared/view-spec";
import { formatDelta, formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "comparison" }>;

/**
 * The demo's centrepiece: Havering +18% next to Lambeth -7% is the contrast a
 * paragraph destroys. Bars are drawn as plain divs — no chart library, because
 * the shapes we need are simple and third-party libs are the usual source of
 * hydration bugs.
 */
export function ComparisonTile({
  spec,
  onDrill,
}: {
  spec: Spec;
  onDrill?: (target: DrillTarget) => void;
}) {
  const max = Math.max(...spec.rows.map((r) => r.value));

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between font-mono text-[11px] text-black/35 dark:text-white/35">
          <span>{spec.metricLabel}</span>
          <span>{spec.comparisonLabel ?? ""}</span>
        </div>

        {spec.rows.map((row) => {
          const clickable = Boolean(row.drill && onDrill);
          return (
            <button
              key={row.label}
              type="button"
              disabled={!clickable}
              onClick={() => row.drill && onDrill?.(row.drill)}
              className={`group grid grid-cols-[7rem_1fr_5rem_4rem] items-center gap-3 rounded-md px-1 py-1 text-left ${
                clickable ? "cursor-pointer hover:bg-black/[0.04] dark:hover:bg-white/10" : ""
              }`}
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
            </button>
          );
        })}
      </div>
    </TileFrame>
  );
}
