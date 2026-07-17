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
    <TileFrame title={spec.title} stats={spec.stats}>
      <div className="flex flex-col gap-2">
        <div className="flex justify-between font-mono text-[11px] text-black/35 dark:text-white/35">
          <span>{spec.metricLabel}</span>
          <span>vs 5y</span>
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

              <span className="h-5 rounded-sm bg-black/[0.06] dark:bg-white/10">
                <span
                  className="block h-full rounded-sm bg-sky-500/70 transition-[width]"
                  style={{ width: `${(row.value / max) * 100}%` }}
                />
              </span>

              <span className="text-right font-mono text-xs tabular-nums">
                {formatValue(row.value, spec.unit)}
              </span>

              <span
                className={`text-right font-mono text-xs tabular-nums ${
                  row.delta === undefined
                    ? "text-black/25 dark:text-white/25"
                    : row.delta > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                }`}
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
