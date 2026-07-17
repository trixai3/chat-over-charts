"use client";

import { useState } from "react";
import { Tile } from "@/components/tile-renderer";
import { ALL_FIXTURES, BROKEN_FIXTURE } from "@/shared/fixtures";
import type { DrillTarget } from "@/shared/view-spec";

export default function GalleryPage() {
  const [log, setLog] = useState<string[]>([]);
  const record = (kind: string) => (t: DrillTarget) =>
    setLog((l) => [`${kind} → ${t.level}=${t.value}`, ...l].slice(0, 6));

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">ViewSpec gallery</h1>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Every tile kind, rendered from fixtures. No LLM, no ClickHouse — all numbers are real
          data pulled from the playground.
        </p>
      </header>

      {log.length > 0 && (
        <div className="mb-6 rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
          <p className="mb-1 text-xs font-medium">Click events (drill-down will use these)</p>
          {log.map((l, i) => (
            <p key={i} className="font-mono text-[11px] text-black/50 dark:text-white/50">
              {l}
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-8">
        {ALL_FIXTURES.map(({ name, spec }) => (
          <section key={name}>
            <h2 className="mb-2 font-mono text-[11px] tracking-wide text-black/35 uppercase dark:text-white/35">
              {name}
            </h2>
            <Tile part={spec} onDrill={record(name)} onResolve={record(name)} />
          </section>
        ))}

        <section>
          <h2 className="mb-2 font-mono text-[11px] tracking-wide text-black/35 uppercase dark:text-white/35">
            malformed — proves the safeParse boundary
          </h2>
          <Tile part={BROKEN_FIXTURE} />
        </section>
      </div>
    </main>
  );
}
