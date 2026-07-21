"use client";

import { Tile } from "@/components/tile-renderer";
import { ALL_FIXTURES, BROKEN_FIXTURE } from "@/shared/fixtures";

export default function GalleryPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">ViewSpec gallery</h1>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Every tile kind, rendered from fixtures. No LLM, no ClickHouse — all numbers are real
          data pulled from the playground.
        </p>
      </header>

      <div className="flex flex-col gap-8">
        {ALL_FIXTURES.map(({ name, spec }) => (
          <section key={name}>
            <h2 className="mb-2 font-mono text-[11px] tracking-wide text-black/35 uppercase dark:text-white/35">
              {name}
            </h2>
            <Tile part={spec} />
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
