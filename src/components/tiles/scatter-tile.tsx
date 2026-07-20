"use client";

import { useState } from "react";
import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";
import { ChartTooltip } from "./chart-tooltip";

type Spec = Extract<ViewSpec, { kind: "scatter" }>;

const W = 480;
const H = 220;
const PAD = 10;

export function ScatterTile({ spec }: { spec: Spec }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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
  const hovered = hoverIndex === null ? undefined : spec.points[hoverIndex];

  return (
    <TileFrame title={spec.title} stats={spec.stats} explanation={spec.explanation}>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
          <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--chart-baseline)" strokeWidth={1} />
          <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="var(--chart-baseline)" strokeWidth={1} />
          {/* Surface ring keeps overlapping dots individually legible; the ring is
              also part of the hover target, so small dots stay hittable. */}
          {spec.points.map((point, index) => (
            <circle
              key={point.label}
              className="chart-fade"
              style={{ animationDelay: `${Math.min(index * 14, 280)}ms` }}
              cx={x(point.x)}
              cy={y(point.y)}
              r={hoverIndex === index ? 6 : 4.5}
              fill="var(--series-1)"
              fillOpacity={hoverIndex === null || hoverIndex === index ? 1 : 0.45}
              stroke="var(--tile-surface)"
              strokeWidth={1.5}
              onPointerEnter={() => setHoverIndex(index)}
              onPointerLeave={() => setHoverIndex(null)}
            />
          ))}
        </svg>
        {hovered && (
          <ChartTooltip
            style={{
              left: `${Math.min(88, Math.max(12, (x(hovered.x) / W) * 100))}%`,
              top: `${(y(hovered.y) / H) * 100}%`,
            }}
          >
            <div className="text-[11px] font-medium">{hovered.label}</div>
            <div className="font-mono text-[10px] text-black/50 dark:text-white/50">
              {spec.xLabel}: {formatValue(hovered.x, spec.xFormat)}
            </div>
            <div className="font-mono text-[10px] text-black/50 dark:text-white/50">
              {spec.yLabel}: {formatValue(hovered.y, spec.yFormat)}
            </div>
          </ChartTooltip>
        )}
      </div>
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
