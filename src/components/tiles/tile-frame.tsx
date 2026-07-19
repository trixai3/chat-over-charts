import type { ReactNode } from "react";
import type { ExplanationManifest, QueryStats } from "@/shared/view-spec";
import { formatStats } from "@/shared/format";

export function TileFrame({
  title,
  stats,
  explanation,
  children,
}: {
  title?: string;
  stats?: QueryStats;
  explanation?: ExplanationManifest;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-black/10 bg-white p-4 shadow-sm dark:border-white/15 dark:bg-white/5">
      {title && (
        <h3 className="mb-3 text-sm font-medium text-black/70 dark:text-white/70">{title}</h3>
      )}
      <div className="flex-1">{children}</div>
      {stats && (
        <div className="mt-3 border-t border-black/5 pt-2 font-mono text-[11px] text-black/40 dark:border-white/10 dark:text-white/40">
          {formatStats(stats.rowsRead, stats.elapsedMs)}
        </div>
      )}
      {explanation && (
        <details className="mt-2 border-t border-black/5 pt-2 text-xs dark:border-white/10">
          <summary className="cursor-pointer font-medium text-black/50 dark:text-white/50">
            How this figure was made
          </summary>
          <div className="mt-3 space-y-3 text-black/60 dark:text-white/60">
            <div>
              <p className="font-medium text-black/75 dark:text-white/75">What is shown</p>
              <p>{explanation.whatShown}</p>
            </div>
            <div>
              <p className="font-medium text-black/75 dark:text-white/75">Calculation</p>
              <p>{explanation.calculation}</p>
            </div>
            {explanation.scope.length > 0 && (
              <div>
                <p className="font-medium text-black/75 dark:text-white/75">Scope</p>
                <ul className="list-disc pl-4">
                  {explanation.scope.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            {explanation.limitations.length > 0 && (
              <div>
                <p className="font-medium text-black/75 dark:text-white/75">Limitations</p>
                <ul className="list-disc pl-4">
                  {explanation.limitations.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            )}
            <div className="font-mono text-[10px] text-black/40 dark:text-white/40">
              <p>{explanation.provenance.source} · refreshed {explanation.provenance.lastRefresh}</p>
              <p>
                {explanation.provenance.semanticModel} v{explanation.provenance.modelVersion} · policy v{explanation.provenance.figurePolicyVersion}
              </p>
              {explanation.provenance.queryId && <p>query {explanation.provenance.queryId}</p>}
            </div>
            <details>
              <summary className="cursor-pointer font-medium">Inspect semantic query and SQL</summary>
              <p className="mt-2 font-medium">Semantic query</p>
              <pre className="mt-1 overflow-x-auto rounded bg-black/[0.04] p-2 text-[10px] dark:bg-white/[0.06]">
                {explanation.inspect.semanticQuery}
              </pre>
              <p className="mt-2 font-medium">Generated SQL</p>
              <pre className="mt-1 overflow-x-auto rounded bg-black/[0.04] p-2 text-[10px] dark:bg-white/[0.06]">
                {explanation.inspect.generatedSql}
              </pre>
            </details>
          </div>
        </details>
      )}
    </div>
  );
}
