import type { ViewSpec } from "@/shared/view-spec";

type Spec = Extract<ViewSpec, { kind: "verdict" }>;

const TONE = {
  good: "border-emerald-500/30 bg-emerald-500/5",
  bad: "border-rose-500/30 bg-rose-500/5",
  neutral: "border-black/10 bg-black/[0.02] dark:border-white/15 dark:bg-white/5",
} as const;

/**
 * The only text the product produces. It is a headline, not prose — if this
 * ever grows into a paragraph, we have missed the brief.
 */
export function VerdictTile({ spec }: { spec: Spec }) {
  return (
    <div className={`rounded-xl border p-5 ${TONE[spec.tone]}`}>
      <p className="text-xl leading-snug font-semibold tracking-tight">{spec.headline}</p>
      {spec.detail && (
        <p className="mt-2 text-sm text-black/50 dark:text-white/50">{spec.detail}</p>
      )}
    </div>
  );
}
