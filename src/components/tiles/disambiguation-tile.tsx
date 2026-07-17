"use client";

import type { DrillTarget, ViewSpec } from "@/shared/view-spec";

type Spec = Extract<ViewSpec, { kind: "disambiguation" }>;

/**
 * The visible half of Trigger.dev's HITL primitive. The tool that emits this
 * spec has no `execute`, so the run is suspended — unbilled and holding no
 * concurrency slot — until `onResolve` completes the waitpoint.
 *
 * 62% of Land Registry localities span multiple districts, and "Clapham"'s
 * largest match is in Bedfordshire, not London. Guessing here is how the demo
 * dies; asking is both correct and, conveniently, textbook chat.agent().
 */
export function DisambiguationTile({
  spec,
  onResolve,
}: {
  spec: Spec;
  onResolve?: (target: DrillTarget) => void;
}) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="text-sm font-medium">{spec.prompt}</p>
      <p className="mt-0.5 font-mono text-[11px] text-black/40 dark:text-white/40">
        “{spec.query}” matches {spec.candidates.length} places — run suspended
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {spec.candidates.map((c) => (
          <button
            key={`${c.target.level}:${c.target.value}:${c.label}`}
            type="button"
            onClick={() => onResolve?.(c.target)}
            className="rounded-lg border border-black/10 bg-white px-3 py-2 text-left transition-colors hover:border-amber-500/50 hover:bg-amber-500/10 dark:border-white/15 dark:bg-white/5"
          >
            <span className="block text-xs font-medium">{c.label}</span>
            {c.sublabel && (
              <span className="block font-mono text-[10px] text-black/40 dark:text-white/40">
                {c.sublabel}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
