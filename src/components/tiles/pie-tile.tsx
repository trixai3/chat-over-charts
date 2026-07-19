"use client";

import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "pie" }>;

const SIZE = 160;
const CENTER = SIZE / 2;
const OUTER_R = 70;
const INNER_R = 40; // donut hole, not a full pie — keeps the legend legible next to it
const COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316"];

function arcPath(startAngle: number, endAngle: number): string {
  const point = (r: number, angle: number): [number, number] => [
    CENTER + r * Math.sin(angle),
    CENTER - r * Math.cos(angle),
  ];
  const [x1, y1] = point(OUTER_R, startAngle);
  const [x2, y2] = point(OUTER_R, endAngle);
  const [x3, y3] = point(INNER_R, endAngle);
  const [x4, y4] = point(INNER_R, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${x1} ${y1}`,
    `A ${OUTER_R} ${OUTER_R} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${INNER_R} ${INNER_R} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

/**
 * Pie is only ever built from an additive measure (chart-policy compatible()
 * enforces this) so summing slices into a whole is truthful here.
 */
type Arc = { slice: Spec["slices"][number]; path: string; color: string; fraction: number };

export function PieTile({ spec }: { spec: Spec }) {
  const total = spec.slices.reduce((sum, slice) => sum + slice.value, 0);
  // Functional scan (no reassigned accumulator) so this stays safe under the
  // React Compiler's render-purity check.
  const arcs = spec.slices.reduce<{ items: Arc[]; cursor: number }>(
    (acc, slice, index) => {
      const fraction = total > 0 ? slice.value / total : 0;
      const endAngle = acc.cursor + fraction * Math.PI * 2;
      const arc: Arc = {
        slice,
        path: arcPath(acc.cursor, endAngle),
        color: COLORS[index % COLORS.length],
        fraction,
      };
      return { items: [...acc.items, arc], cursor: endAngle };
    },
    { items: [], cursor: 0 },
  ).items;

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <div className="flex items-center gap-4">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="h-32 w-32 shrink-0"
          role="img"
          aria-label={spec.title}
        >
          {arcs.map(({ slice, path, color }) => (
            <path key={slice.label} d={path} fill={color} stroke="white" strokeWidth={1} />
          ))}
        </svg>
        <ul className="flex flex-1 flex-col gap-1.5">
          {arcs.map(({ slice, color, fraction }) => (
            <li key={slice.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5 truncate">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span className="truncate font-medium">{slice.label}</span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-black/50 dark:text-white/50">
                {formatValue(slice.value, spec.format)} · {(fraction * 100).toFixed(0)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-2 text-[11px] text-black/40 dark:text-white/40">{spec.metricLabel}</p>
    </TileFrame>
  );
}
