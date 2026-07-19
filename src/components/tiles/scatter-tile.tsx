"use client";

import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "scatter" }>;

const W = 480;
const H = 220;
const PAD = 10;

export function ScatterTile({ spec }: { spec: Spec }) {
  const xs = spec.points.map((point) => point.x);
  const ys = spec.points.map((point) => point.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xSpan = xMax - xMin || 1;
  const ySpan = yMax - yMin || 1;
  const x = (value: number) => PAD + ((value - xMin) / xSpan) * (W - PAD * 2);
  const y = (value: number) => H - PAD - ((value - yMin) / ySpan) * (H - PAD * 2);

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
        <line
          x1={PAD}
          y1={H - PAD}
          x2={W - PAD}
          y2={H - PAD}
          stroke="currentColor"
          strokeOpacity={0.15}
        />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="currentColor" strokeOpacity={0.15} />
        {spec.points.map((point) => (
          <circle key={point.label} cx={x(point.x)} cy={y(point.y)} r={4} fill="#0ea5e9" fillOpacity={0.75}>
            {/* Hover-only label — no chart library, so this is the plain SVG affordance. */}
            <title>
              {`${point.label}: ${formatValue(point.x, spec.xFormat)}, ${formatValue(point.y, spec.yFormat)}`}
            </title>
          </circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>
          {spec.xLabel}: {formatValue(xMin, spec.xFormat)}–{formatValue(xMax, spec.xFormat)}
        </span>
        <span>
          {spec.yLabel}: {formatValue(yMin, spec.yFormat)}–{formatValue(yMax, spec.yFormat)}
        </span>
      </div>
    </TileFrame>
  );
}
