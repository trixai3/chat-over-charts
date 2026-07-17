"use client";

import type { ViewSpec } from "@/shared/view-spec";
import { formatValue } from "@/shared/format";
import { TileFrame } from "./tile-frame";

type Spec = Extract<ViewSpec, { kind: "timeseries" }>;

const W = 480;
const H = 140;
const PAD = 4;

export function TimeseriesTile({ spec }: { spec: Spec }) {
  const values = spec.points.map((p) => p.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series would divide by zero; fall back to a mid-height line.
  const span = max - min || 1;

  const x = (i: number) =>
    spec.points.length === 1 ? W / 2 : (i / (spec.points.length - 1)) * (W - PAD * 2) + PAD;
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2);

  const line = spec.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.v)}`).join(" ");
  const area = `${line} L ${x(spec.points.length - 1)} ${H} L ${x(0)} ${H} Z`;

  const first = spec.points[0];
  const last = spec.points[spec.points.length - 1];

  return (
    <TileFrame title={spec.title} stats={spec.stats}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={spec.title}>
        <path d={area} className="fill-sky-500/10" />
        <path
          d={line}
          className="stroke-sky-500"
          strokeWidth={2}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-black/40 dark:text-white/40">
        <span>
          {first.t} · {formatValue(first.v, spec.unit)}
        </span>
        <span>
          {last.t} · {formatValue(last.v, spec.unit)}
        </span>
      </div>
    </TileFrame>
  );
}
