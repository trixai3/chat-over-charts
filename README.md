# Chat Over Charts

**Chat with your data and get answers as governed figures, not paragraphs — shown here on UK house prices.**

Built for the [ClickHouse × Trigger.dev Virtual Summer Hackathon 2026](https://triggerdev.clickhouse.com).

---

## The idea

Ask "where can I actually afford to live?" and every other chat agent hands you a wall of text.
This one **never returns prose**. Every answer is a typed **ViewSpec** that renders as a chart, and
every chart carries its provenance: the exact SQL, rows scanned, and query time. The only text the
product produces is a single headline verdict.

## Under the hood: a question becomes a figure

The whole path, one line:

> user query → durable run (bind source) → system prompt → `inspectAnalysis` (resolve terms + pick
> provisional figure) → *[`requestClarification` suspends the run if ambiguous]* → `renderAnalysis`
> (SQL → validate → finalize figure → ViewSpec) → `emitVerdict` → tiles render

Everything below is trusted code **except the tool choices** — which tool to call and what semantic
terms to fill in is the model's entire job.

**1. The browser opens a durable run.**
[`src/components/chat.tsx`](src/components/chat.tsx) wires `useTriggerChatTransport` to the
`house-agent` task and calls `sendMessage`. The two server actions in
[`src/app/actions.ts`](src/app/actions.ts) — `createStartSessionAction` and a session-scoped token
mint — start the run and authorize it. These are Next.js **server actions**, not API routes
(invariant 7); the browser never sees a secret key.

**2. The run boots and binds the source server-side.**
[`trigger/house-agent.ts`](trigger/house-agent.ts) is the entire backend, one `chat.agent()`.
`onBoot` calls `bindSource(clientData.sourceId)`
([`src/agent/source-context.ts`](src/agent/source-context.ts)) — the model never sees or sets which
source it queries. `run` is a single `streamText` with `stopWhen: stepCountIs(15)`; the model picks
its own steps (invariant 4), not a fixed prompt chain.

**3. The system prompt is mechanics + generated vocabulary.**
A fixed generic block (the tool loop, clarification protocol, figure-selection cues) plus
`sourcePromptCatalog(model)` ([`src/agent/source-prompt.ts`](src/agent/source-prompt.ts)), which
generates the measure synonyms, distribution notes, and hints from the bound `SemanticModel`. No
measure or column name is hard-coded in the agent layer.

**4. The model resolves the question — `inspectAnalysis`.**
Defined in [`src/agent/tools.ts`](src/agent/tools.ts). The model fills a Zod-validated intent
(measure/dimension terms, filters, optional preferred figure) — never SQL. `execute` runs
`planWithMemberResolution` ([`src/analysis/member-resolver.ts`](src/analysis/member-resolver.ts)) →
`planAnalysis` ([`src/analysis/semantic-model.ts`](src/analysis/semantic-model.ts)) +
`selectProvisionalFigure` ([`src/analysis/chart-policy.ts`](src/analysis/chart-policy.ts)).
`toModelOutput` compresses the result to one line — `READY`, `NEEDS_CLARIFICATION`, or `UNSUPPORTED`
— so rendering data never enters the prompt (invariant 2).

**5. Ambiguity suspends the run — `requestClarification`.**
This tool has **no `execute`**, so Trigger.dev suspends the durable run (human-in-the-loop) until the
frontend adds the picked option via `addToolOutput` (back in `chat.tsx`). This is the "which
London?" / "too many districts to plot" / "which Clapham?" gate; the candidate list comes from a
live governed `GROUP BY` in [`member-resolver.ts`](src/analysis/member-resolver.ts), never a guess.

**6. Trusted code renders — `renderAnalysis`.** No LLM from here on:
- `compileClickHouseQuery` ([`src/analysis/clickhouse-adapter.ts`](src/analysis/clickhouse-adapter.ts))
  — parameterized SQL only: `quantileTDigest` medians, `lagInFrame(…) OVER trend_window` for
  vs-previous-period deltas, `histogramIf(20)` clipped to P0.5–P99.5 for distributions.
- `ClickHouseAdapter.execute` runs it on ClickHouse Cloud and returns rows plus `QueryStats` (rows
  read, ms, query id).
- `runAnalysis` ([`src/analysis/pipeline.ts`](src/analysis/pipeline.ts)) validates the dataset, calls
  `finalizeFigure` on the *actual* result shape, then `buildSpec` assembles the typed `ViewSpec`
  ([`src/shared/view-spec.ts`](src/shared/view-spec.ts)) with its `ExplanationManifest` — the exact
  SQL, provenance, and limitations shown in the tile footer. Empty results, validation failures, or a
  spec over the ~700 KB stream cap become a governed `notice` tile, never a crash. `summarizeSpec`
  hands the model one summary line; it never sees the figure it just produced.

**7. The verdict ends the run — `emitVerdict`.**
The one and only way to conclude (invariant 1: no prose channel exists). On the final allowed step,
`prepareStep` in [`house-agent.ts`](trigger/house-agent.ts) mechanically forces this call via
`toolChoice`, so a run can never burn its step budget and end verdict-less.

**8. Tiles render.**
Tool outputs stream back into `useChat().messages`.
[`src/components/tile-renderer.tsx`](src/components/tile-renderer.tsx) runs `ViewSpec.safeParse` — the
single runtime validation boundary (invariant 6) — and dispatches to a component in
[`src/components/tiles/`](src/components/tiles/). The `satisfies Record<ViewSpecKind, …>` on the
renderer map turns a forgotten renderer into a compile error instead of a blank tile mid-demo.

## Stack

| | |
|---|---|
| Runtime | Trigger.dev `chat.agent()` (`@trigger.dev/sdk` ≥4.5.0) |
| Model layer | Vercel AI SDK **v6**; provider switch (`MODEL_PROVIDER`) — OpenRouter (dev default) or `@ai-sdk/anthropic` (demo) |
| Data | ClickHouse Cloud |
| Frontend | Next.js 16, React 19, Tailwind v4 |

> ⚠️ Install AI SDK packages by **dist-tag**, not version number — the majors don't line up
> (`ai@6` pairs with `@ai-sdk/react@3`):
>
> ```bash
> npm i ai@ai-v6 @ai-sdk/react@ai-v6 @ai-sdk/anthropic@ai-v6
> ```

## Running it

```bash
npm install
cp .env.example .env.local   # then fill in your own values
npm run dev                  # Next.js frontend
npx trigger.dev@4.5.5 dev    # Trigger.dev worker — pin the CLI to the installed SDK version
```

You need a ClickHouse service, a [Trigger.dev](https://trigger.dev) project, and a model API key
(Anthropic direct, or anything via OpenRouter) — see `.env.example`.

- `/gallery` — every tile kind rendered from fixtures. No LLM, no ClickHouse needed.
- `npm test` — the full suite runs against fixtures; live ClickHouse tests skip without credentials.

## Onboarding a new data source

The engine is source-agnostic: a data source is a **Source Pack** — one declarative
`SemanticModel` object. Adding one touches no agent, planner, compiler, chart, or renderer code
(proven by [`tests/analysis/second-source.test.ts`](tests/analysis/second-source.test.ts), which runs a
structurally different transit dataset through the whole engine with zero production changes).

**1. Write the pack** — `src/analysis/sources/<your-source>/model.ts`, exporting a `SemanticModel`
([`src/analysis/types.ts`](src/analysis/types.ts)):

| Field | What it declares |
|---|---|
| `id`, `label`, `database`, `table` | Identity and the one relation the pack owns (a table **or a view**) |
| `dimensions` | Columns to group/filter by — with synonyms, time `grains`, optional snapshotted `values` |
| `valueFields` | A raw numeric column + its **vetted aggregation menu** (median/p25/p75/p90/max); measures are generated from this grammar |
| `measures` | Hand-registered aggregates (counts, etc.) when the grammar doesn't fit |
| `defaults` | Default measure, time dimension, and grain |
| `memberResolvers` | High-cardinality dimensions resolved by live lookup, disambiguated by declared ancestor hierarchy |
| `promptHints`, `exampleQuestions` | Per-source reasoning guidance and the UI's "Try asking" starters |

The housing pack
([`src/analysis/sources/england-wales-house-prices/model.ts`](src/analysis/sources/england-wales-house-prices/model.ts))
is the full-featured reference; the synthetic pack inside `second-source.test.ts` is the minimal one.

**2. Register it** — one line in
[`src/analysis/sources/index.ts`](src/analysis/sources/index.ts):

```ts
export const SOURCES: SemanticModel[] = [ukHousePrices, yourSource];
```

**3. Restart both dev servers.** The source appears in the left-panel dropdown with its
database/table provenance. Switching sources starts a new conversation — the chosen source is bound
server-side for the whole session, so the model can neither pick nor drift.

The agent's vocabulary is generated from your pack (`sourcePromptCatalog`), so synonyms carry
intent: declare `"affordable" → p25` once and "affordable areas" just works.

## Limitations

Honest edges of the current build:

- **One relation per source.** A pack owns exactly one table or view — no joins in the semantic
  layer. Multi-table today = create a ClickHouse **view** and point the pack at it.
- **ClickHouse only, one service.** All packs share the single connection from `.env.local`.
- **Packs are compile-time trusted code.** No runtime plugin loading, and no registration-time
  validation yet — a pack referencing a missing column fails at query time, not at boot.
- **Closed aggregation grammar.** `median/p25/p75/p90/max` plus registered measures; `avg`/`sum`
  are deliberately absent (right-skewed data). Additive measures like counts are supported via
  `measures`.
- **One question ↔ one source.** No cross-source queries; switching is a new conversation by design.
- **Running the chat needs accounts** — a Trigger.dev project and a model API key. `/gallery` and
  the test suite work without either.

## Future plan

- **[Architecture V3](docs/architecture-v3.md)** *(designed, parked)* — multiple tables with
  declared **many-to-one joins** inside one source pack, star-schema only (one-to-many fan-out is
  rejected at registration, not "solved"). Pack-owned views are the v0.
- **Pack authoring kit** — registration-time Zod validation with actionable errors, a
  `sources/_template/`, and a golden-question harness so pack authors can smoke-test against their
  own data.
- **Hallucination-hardening pass** ([Architecture V2](docs/architecture-v2.md)) — sealed plan IDs,
  a figure registry, evidence-bound verdicts. Orthogonal to source count; deferred deliberately.
- **A second real source pack** — the acceptance test that the onboarding story holds for a
  stranger's data.

## License

MIT — see [LICENSE](LICENSE).
