# Beyond the Wall of Text

**Chat with your data and get answers as governed figures, not paragraphs — shown here on UK house prices.**

Built for the [ClickHouse × Trigger.dev Virtual Summer Hackathon 2026](https://triggerdev.clickhouse.com).

---

## The idea

Ask "where can I actually afford to live?" and every other chat agent hands you a wall of text.
This one **never returns prose**. Every answer is a typed **ViewSpec** that renders as a chart, and
every chart carries its provenance: the exact SQL, rows scanned, and query time. The only text the
product produces is a single headline verdict.

## How it stays honest

The LLM's job is deliberately small: translate the question into a constrained analysis intent
(governed measure and dimension IDs, closed enums, Zod-validated tool params). Trusted code does
everything else — resolves terms against the semantic layer, compiles the ClickHouse SQL, picks a
compatible figure, and builds the ViewSpec.

- **The LLM never writes SQL.** Not a fragment, not a table name.
- **The data source is bound server-side per session.** The model cannot pick or switch sources.
- **Metrics are medians** (`quantileTDigest`), never averages — prices are heavily right-skewed and
  `avg(price)` is a lie.
- Ambiguous place names ("Clapham" resolves to 11 places across 6 counties) trigger a live governed
  lookup and a disambiguation prompt instead of a silent guess.

## How ClickHouse and Trigger.dev are used

**ClickHouse** is the primary database — 31M Land Registry sales (1995 → May 2026), loaded into our
own Cloud service with our own schema and ORDER BY key. Every query is an aggregate; only small
results are streamed. It also answers member resolution live (which districts does this locality
span?) in tens of milliseconds.

**Trigger.dev** is not orchestration bolted on the side — it *is* the backend. `chat.agent()` runs
each conversation as one long-lived durable task; there are **no Next.js API routes**. Place
disambiguation suspends the run (human-in-the-loop) until the user picks.

## Stack

| | |
|---|---|
| Runtime | Trigger.dev `chat.agent()` (`@trigger.dev/sdk` ≥4.5.0) |
| Model layer | Vercel AI SDK **v6** + `@ai-sdk/anthropic` |
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
(proven by [`src/analysis/second-source.test.ts`](src/analysis/second-source.test.ts), which runs a
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
