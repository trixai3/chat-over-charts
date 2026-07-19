import type { ViewSpec } from "@/shared/view-spec";

type Spec = Extract<ViewSpec, { kind: "notice" }>;

const TONE = {
  warning: "border-amber-500/30 bg-amber-500/5",
  error: "border-rose-500/30 bg-rose-500/5",
  neutral: "border-black/10 bg-black/[0.02] dark:border-white/15 dark:bg-white/5",
};

export function NoticeTile({ spec }: { spec: Spec }) {
  return (
    <div className={`rounded-xl border p-4 ${TONE[spec.tone]}`}>
      <p className="text-sm font-medium">{spec.title}</p>
      <p className="mt-1 text-sm text-black/55 dark:text-white/55">{spec.message}</p>
      {spec.suggestions.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-black/45 dark:text-white/45">
          {spec.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
        </ul>
      )}
    </div>
  );
}
