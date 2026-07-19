# Build Plan — ClickHouse × Trigger.dev Hackathon 2026

**Theme:** Beyond the Wall of Text
**Window:** 17 July 09:00 CET → 23 July (see [deadline risk](#risk-2--the-deadline-is-ambiguous))
**Entrant:** Trish, solo
**Status:** planning → build

---

## 1. The brief, compressed

Build a chat agent on **Trigger.dev + ClickHouse** where the *response itself* is the product:
visual, interactive, explorable. The judging lens is stated bluntly:

> Ratio of insight to words. Text is the garnish, not the meal.

If the agent's best answer is a paragraph, we've missed the brief.

### Hard constraints

- ClickHouse must be the **primary database**. Trigger.dev must do **meaningful orchestration**.
  Superficial use of either = disqualified.
- **All code written inside the build window.** (Repo was empty at 17 July — good.)
- Public GitHub repo, **MIT or Apache-2.0**, public through judging.
- Demo video, **max 5 minutes**, opening *directly* on the working product — no intro.
- Written description of how ClickHouse and Trigger.dev are each used.

### Scoring

| Criterion | Weight |
|---|---|
| Use of ClickHouse & Trigger.dev | 25% |
| Problem fit | 20% |
| Technical implementation | 20% |
| Innovation | 20% |
| Scalability & impact | 10% |
| Presentation | 5% |

Judged by a panel of 15+. A separate bonus prize exists for best OLTP + OLAP integration —
**deliberately skipped** to stay focused on the main rubric.

---

## 2. Dataset decision: UK house prices (`uk_price_paid`)

**Question the product answers: "Where can I actually afford to live?"**

### How we got here

Surveyed every dataset in the ClickHouse playground, filtered to ones a normal person has real
intuition for. Freshness turned out to be decisive:

| Dataset | Rows | Data ends | Verdict |
|---|---|---|---|
| **uk_price_paid** (house prices) | 31M | **Mar 2026** | **Current** |
| tranco (site rankings) | 1.8B | Jan 2024 | Stale, not relatable |
| pypi (package uploads) | 1.0B | Sep 2023 | Stale |
| hackernews | 37M | Aug 2023 | Stale |
| noaa (weather) | 1.1B | Sep 2022 | Stale |
| forex | 11.6B | Aug 2022 | Stale; thin schema (bid/ask only) |
| ontime (flight delays) | 205M | Mar 2022 | Stale, but rich |
| opensky (flight tracks) | 66M | Jun 2021 | Stale |
| cell_towers | 43M | Feb 2021 | Stale |
| covid | 8.7M | Oct 2021 | Dead |
| stock | 15M | Dec 2006 | Twenty years dead |
| trips (NYC taxi) | 3.5B | dates run to 2090 | Dirty |
| recipes / menus | 2.2M / 17K | no time axis | No time dimension |

**`uk_price_paid` is the only current dataset in the entire playground.** Everything else is frozen
between 2021 and 2024. The brief asks for ClickHouse as a *real-time data layer*; we cannot demo
real-time over data that stopped in 2022 — a judge will see the axis end.

Verified recency directly: 42,262 sales in Feb 2026, still landing, with the ~2-month lag expected
from Land Registry reporting.

### Why it wins beyond freshness

1. **The drill-down is free and it's the whole product.** The geography tree
   (county → district → town → street → postcode) is a natural drill mechanic. Every drill is a
   fresh ClickHouse query — that's how a chart becomes a *live query surface* rather than a picture
   the agent attached.
2. **31M rows is a feature.** Small enough to load into *our own* ClickHouse Cloud in minutes,
   inside $400 of credits — so we own the schema, the materialized views, the projections. That is
   what "depth, creativity, and correctness in leveraging ClickHouse" actually rewards.
3. **Universally understood, emotionally charged.** Good for five minutes of video.

### The honest risk

`uk_price_paid` is ClickHouse's own flagship tutorial dataset — all 15 judges know it cold. That
cuts both ways: they can properly judge our query craft, but **the dataset itself scores zero
innovation points.** Innovation must live in the *response architecture*. That's the right place
for it, since that's what the theme is about.

### Proof the mechanic works

Real query against live 2025/2026 data, sub-second:

```
┌─district───┬─sales_2025─┬─median_2025─┬─pct_growth_5y─┐
│ WANDSWORTH │       4970 │      630000 │            -1 │
│ HAVERING   │       3456 │      445500 │          17.9 │
│ LAMBETH    │       3892 │      526890 │          -7.2 │
└────────────┴────────────┴─────────────┴───────────────┘
```

Wandsworth flat, Havering up 18%, Lambeth **down** 7%. A map tells that instantly; a paragraph
destroys it. **This contrast is the demo.**

---

## 3. The bet

> The agent never returns prose. It returns a **typed view spec** that the frontend renders, and
> every rendered view is clickable — each click fires a fresh ClickHouse query and drills a level
> down the geography tree.

Aimed straight at the "explorable, not decorative" half of the theme.

---

## 4. The `chat.agent()` finding — this reframes the whole build

**Verified 17 July against npm and live docs.** `@trigger.dev/sdk@4.5.4` published **2026-07-14**
(three days ago). Subpath exports `./ai`, `./chat`, `./chat/react` all present. Peer dep
`ai: ^5.0.0 || ^6.0.0`.

**Trigger.dev's AI Agents platform — `chat.agent`, Sessions, AI Prompts — went GA in v4.5.0 on
2026-07-02. Fifteen days before this hackathon opened.**

That is not a coincidence. **This hackathon is a showcase for `chat.agent()`**, and the greyed-out
line in handbook §4.2 ("Solutions must also use the Trigger.dev `chat.agent()`") is a real
instruction, not a leftover.

### What it changes

`chat.agent()` runs **each conversation as one long-lived durable task** — it wakes on a message,
freezes when idle, and in-memory state plus the on-disk workspace survive page refreshes, deploys,
idle gaps and crashes. The docs are explicit that it *"replaces a fragile Next.js API route."*
`useTriggerChatTransport` then runs the AI SDK's `useChat` over Trigger.dev Realtime **with no API
routes at all.**

So Trigger.dev is not orchestration bolted onto the side of the product. **Trigger.dev _is_ the
backend.** The previous plan's "the query-time Trigger.dev story is thin" risk is dead —
it was an artefact of designing against the wrong API.

```ts
import { chat } from "@trigger.dev/sdk/ai";
import { streamText, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export const myChat = chat.agent({
  id: "my-chat",
  run: async ({ messages, signal }) => {
    return streamText({
      ...chat.toStreamTextOptions(),
      model: anthropic("claude-sonnet-4-5"),
      messages,
      abortSignal: signal,
      stopWhen: stepCountIs(15),
    });
  },
});
```

### Two pattern tracks — do not confuse them

- `/docs/guides/ai-agents` — prompt chaining, routing, parallelization, orchestrator-workers,
  evaluator-optimizer. Plain `task()` + `generateText`. **Older track. The resources PDF links this.**
- `/docs/ai-chat/*` — `chat.agent()` and its 13 operational patterns (HITL, sub-agents, skills,
  branching, persistence-and-replay, compaction, …). **Current flagship. The handbook names this.**

**We build on the `chat.agent()` track.**

---

## 5. Architecture

### 5.1 Data layer — ClickHouse (our own service, not the playground)

The playground is for prototyping. We load Land Registry data into **our** ClickHouse Cloud. The
difference between *using* ClickHouse and *owning a data layer* is the 25% criterion.

- Our own `ORDER BY` key, tuned for the geo drill-down
- Materialized views rolling up monthly medians per district → drills return instantly
- `quantileTDigest` for medians at scale
- A **dictionary** backing place resolution (see 5.2) — `dictGet` is fast and distinctively ClickHouse
- Codec and `LowCardinality` choices we can justify **on camera**

### 5.2 Semantic layer — thin, but one part is demo-critical

Not Cube, not dbt metrics, no YAML semantic model. Three small pieces only:

**a) The place resolver — the one that saves the demo.**

The data stores `county='GREATER LONDON'`, `district='LAMBETH'`, `locality='CLAPHAM'`. Users type
"Clapham", "north London", "SW11". Measured reality:

| | count |
|---|---|
| counties | 132 |
| districts | 467 |
| towns | 1,173 |
| localities | 24,049 |
| streets | 338,514 |
| outcodes | 2,394 |

**7,726 localities (32%) span multiple counties; 14,961 (62%) span multiple districts.** "Clapham"
alone resolves to 11 places across 6 counties:

```
┌─county──────────┬─district───┬─sales─┐
│ BEDFORDSHIRE    │ BEDFORD    │  1359 │  ← naive match sends you HERE
│ BEDFORD         │ BEDFORD    │  1183 │
│ GREATER LONDON  │ LAMBETH    │   559 │  ← what the user meant
│ NORTH YORKSHIRE │ CRAVEN     │   226 │
│ GREATER LONDON  │ WANDSWORTH │   150 │
└─────────────────┴────────────┴───────┘
```

Note `BEDFORDSHIRE` **and** `BEDFORD` both appear as counties, and `NORTH BEDFORDSHIRE` /
`MID BEDFORDSHIRE` are defunct districts — thirty years of local-government reorganization is baked
in, so one physical place wears several administrative names depending on when it sold.

**A naive resolver sends someone asking about Clapham to Bedford. That is demo death.**

> **The resolver splits in two — and this de-risks the plan (decided 18 Jul).** The demo-critical
> behaviour ("Clapham" → disambiguation, not Bedford) needs **only a live SQL query**, verified:
> `WHERE locality='CLAPHAM' GROUP BY county, district` returns 5 places in 836ms, biggest in
> Bedfordshire. **No offline pipeline, no LLM, no dictionary.** That's the Day 3 core.
>
> The **offline LLM dictionary** (7,726 localities → `dictGet`) handles what SQL can't — aliases
> ("north London"), postcodes ("SW4"), misspellings, defunct-district collapse. It was sold as the
> *"why Trigger.dev matters"* story, but `chat.agent()` is now the whole backend, so Trigger.dev no
> longer depends on it. **Demoted from Day-3 foundation to Day-5 enhancement.** See IMPLEMENTATION §4a.

**b) A metrics registry.** One module defining "median price", "5-year growth", etc.
`avg(price)` is a *lie* on house prices — the distribution is heavily skewed (`other` averages
£1.18M). Median via `quantileTDigest` is honest. Define it once, defend it once.

**c) The dimension hierarchy.** The geo tree declared as data, so drill-down is generic.

### 5.3 The agent contract

| Tool | Produces |
|---|---|
| `mapPrices` | choropleth |
| `priceHistory` | timeseries |
| `compareAreas` | comparison |
| `distribution` | histogram |
| `affordability` | affordability view |
| `disambiguatePlace` | **no `execute`** → HITL pause (see 5.4) |
| **`emitVerdict`** | the one-line verdict — **see below, this is load-bearing** |

The LLM chooses tools and parameters. **It does not write SQL.**

> **The trade-off, stated so it can be defended.** Letting the LLM write raw SQL is more flexible
> and scores easy innovation points — but it's a coin flip on camera, and a demo that hallucinates
> a column name is a dead demo. Constrained tools are reliable and reviewable.
>
> **Decision:** tools for the core. *If* ahead by Day 5, add one guarded free-form query tool
> (read-only user, row limit, timeout) to buy the "ask anything" feel without betting the demo on it.

#### The verdict is a tool, not free text — that's what makes "no prose" structural

A system prompt saying *"never output prose"* is a **soft** constraint. The model will violate it;
explaining is what it's built to do.

Make the verdict a **tool** and the model has no channel for prose at all. It wants to conclude? It
must call `emitVerdict({ headline, detail?, tone })`, and `headline` is one string field. The
frontend renders tiles only.

**This turns "text is the garnish" from a prompt we're begging the model to honour into something
the architecture makes impossible to violate.** It's also why `verdict` is a ViewSpec kind
(§5.7) rather than a text stream — that was instinct on Day 1; this is the reason.

#### ⚠️ `toModelOutput` — tool results enter the prompt, and that's a trap

**A tool's return value is appended to `messages` and the model reads it on the next step.** So a
tool returning `{data, viewSpec, queryStats}` would push every drillTarget, every histogram bin and
every stats field into the prompt. Pure waste — and it bloats the cacheable prefix.

The AI SDK's answer is `toModelOutput`, which splits one result into two paths:

```
tool.execute() → full result
       ├─→ toModelOutput() → one compressed line → the prompt (what the model sees)
       └─→ unchanged        → stream            → the frontend (what renders)
```

```ts
compareAreas: tool({
  inputSchema: z.object({ county: z.string(), budget: z.number() }),
  execute: async (p) => {
    const { rows, stats } = await queryClickHouse(p);
    return { viewSpec: {/* ... */}, rows, stats };   // full → frontend
  },
  toModelOutput: ({ output }) => ({
    type: "text",
    value: "8 districts. £410k–£630k. Cheapest: Havering £445.5k (+17.9%). Steepest fall: Lambeth −7.2%.",
  }),                                                 // one line → model
})
```

**The design judgement is what the model needs to see** — not "as little as possible", because
over-compress and it can't write the verdict. The line is:

- **Rendering needs it** → viewSpec → frontend. (drillTargets, bin counts, stats — the model never
  needs these.)
- **Deciding needs it** → `toModelOutput` → model. (It must know which districts are in budget to
  write "9 of 33 work". It does not need to know how long to draw the bars.)

**This strengthens the whole architecture: the LLM doesn't author ViewSpecs — and it never even
sees one.**

#### ⚠️ The bug that only appears on turn 2

Docs, verbatim:

> **If you only pass tools to `streamText` and not to the config, the transform runs on turn 1 but
> is skipped on every later turn.** The raw output gets stringified back into the prompt instead.

This is the worst kind of bug: ask one question while testing and it never appears. Ask three on
camera and the token count explodes, caching dies, and the model gets confused.

**Tools must be declared on `chat.agent({ tools })`, then read back from the `run()` payload:**

```ts
export const myChat = chat.agent({
  id: "bwt-chat",
  tools,                                        // ← declare HERE, not just on streamText
  run: async ({ messages, tools, signal }) =>   // ← read back from the payload
    streamText({ ...chat.toStreamTextOptions({ tools }), model, messages, abortSignal: signal }),
});
```

**Day 2 test:** ask three questions in a row and assert no ViewSpec JSON appears in the turn-2 and
turn-3 prompts.

### 5.4 Trigger.dev — the capability map

**This table is the answer to "why is Trigger.dev here?" — the question a judge will ask.** Every
row is load-bearing; none is decoration.

| Capability | How we use it | Why it's not superficial |
|---|---|---|
| **`chat.agent()`** | The entire chat backend | Conversation = one long-lived durable run. **No Next.js API routes exist.** |
| **`useTriggerChatTransport`** | Frontend `useChat` over Realtime | No API routes; durable transport |
| **Streams v2** (`streams.define` → `.pipe(result.toUIMessageStream())`) | Tiles + verdict stream to the UI as they land | 28-day retention, resume-from-index, unlimited length |
| **HITL — a tool with no `execute`** | **The disambiguation tile.** "Clapham" is ambiguous → run **pauses** → chips render → user clicks → run resumes | Parked run costs **no billing and no concurrency slot**. Trigger.dev's HITL primitive doing exactly what it's for. |
| **`actionSchema` / `onAction`** | **The drill-down.** Click a tile → action → ClickHouse → new tile, **no model turn** | Same durable run, context preserved, sub-second |
| **`stopSignal` / `onCancel`** | Stop button mid-analysis; partial tiles persisted | `abortSignal` → `streamText`; 30s cleanup budget |
| **`schedules.task()`** | Monthly Land Registry ingest | Real recurring work |
| **`batch.triggerByTask` + `idempotencyKeys`** | The **7,726-locality** LLM dictionary build (8 batches × 1,000 cap) | Retries don't re-pay for the same locality. Genuinely parallel, genuinely expensive. |
| **Machines** (`large-1x`) | 31M-row ingest | Right-sized compute |
| **AI Prompts** | Tune the planner prompt from the dashboard **without redeploying** | Strong demo beat |
| **Sessions / durability** | Refresh the page mid-answer, conversation survives | — |
| **Dashboard (OTel traces)** | The 20s demo beat: run tree, retries, waterfall | Proves it's real |

**Two beautiful fits worth calling out:**

1. **The disambiguation tile _is_ Trigger.dev's HITL primitive.** A tool with no `execute` function
   suspends the run pending human input. Our "Clapham → which one?" chip tile is exactly that
   shape — a visual answer that also happens to be textbook `chat.agent()`. Human thinking time
   isn't billed and doesn't count against `maxDuration`.
2. **The drill-down _is_ an action.** I'd designed "drill-down must skip the LLM" as a custom
   optimisation; `chat.agent()` ships `onAction` for precisely this. Click → action → tool → tile,
   no model turn, same durable run.

**~~Query-time parallel fan-out.~~ DROPPED (17 Jul).** ClickHouse answers in ~50ms; parallelism
saves nothing and weakens the pitch. **Do not put this in the pitch.** *(Note the distinction: the
**offline** batch fan-out over 7,726 localities is kept and is genuinely justified — those are slow
LLM calls, not fast queries.)*

#### Which of Trigger.dev's canonical purposes do we actually lean on?

The table above lists the *features* we touch. This one answers a sharper question: Trigger.dev is
sold as a **background-job runtime** — long windows, retries, realtime logging, webhook/event
triggers. Of those four, how many are load-bearing *for us*? Honest answer: **two, hard; two,
incidental.** That's a deliberate bet on Trigger.dev's *new* face (`chat.agent()` as a durable
conversation runtime) over its *old* face (cron + webhooks + retries).

| Canonical purpose | Do we lean on it? | Weight |
|---|---|---|
| **Long execution window** | Yes — but inverted. Not long *compute*; a run that **suspends to wait on a human at zero cost**. The no-`execute` disambiguation tool parks the run — unbilled, no concurrency slot, `maxDuration` stops ticking — plus the session survives refresh/deploy. | ★★★ load-bearing |
| **Realtime progress** | Yes, strongly. Streams v2 pushes tiles into the UI as they land; the wait shows *tool-loop steps*, not a spinner; `useTriggerChatTransport` runs `useChat` over Realtime with no API routes. | ★★★ load-bearing |
| **Retry logic** | Barely. A ~50ms ClickHouse query needs none; the only real retry story is the *optional* monthly-ingest batch. If a judge expects "watch it retry," we don't have that beat. | ★ incidental |
| **Webhook / event trigger** | Barely. Our trigger is a user typing (frontend → `session.in`). The only genuine scheduled trigger is `schedules.task()` monthly ingest — 🟡 optional/demoted. | ★ incidental |

**The one hard rebuttal to "why not just a plain Next.js app?"** Hand-rolling *suspend-a-run-to-wait-
on-a-human-for-free* + *multi-turn session that survives refresh/deploy* + *reconnecting stream
replay* is a whole state-store-plus-resumption-plus-replay stack. `chat.agent()` gives it for free.
The Clapham beat (§5.5, and the dashboard waitpoint at §11) is where that becomes visible in 20
seconds — which is the point, since "meaningful use" is judged on camera, not asserted in a README.

### 5.5 The user experience — Next.js on Vercel

**This doubles as the demo script.** If a beat here doesn't survive contact with a judge in five
minutes, it's the wrong beat.

#### The journey

| t | What the user sees | What's happening |
|---|---|---|
| **0s** | Input box + 3 example questions. No welcome copy, no intro. | Empty state — users don't know what they can ask. |
| | *types "Where can I afford in London on £600k?"* | |
| **0.2s** | A **grey skeleton verdict card** appears at the top. | `useTriggerChatTransport` starts a chat.agent run, subscribes to the handle. |
| **0.2–3s** | `Locating "London"… ` → `Querying 33 boroughs…` → `Writing the verdict…` | **The tool loop, made visible.** Each step surfaces as it fires. |
| **3s** | **First tile lands.** 33 boroughs; Havering +17.9% green next to Lambeth −7.2% red. Footer: `31.2M rows · 47ms`. | `compareAreas` → ClickHouse → streamed via Streams v2. |
| **4s** | The skeleton **fills in**: *"On £600k you're priced out of 24 of 33 London boroughs — 9 work"* | `emitVerdict` tool call. |

**The user has their answer. Not one word of prose.**

Then the part that actually differentiates us:

| Action | What happens | Why it matters |
|---|---|---|
| **Click Havering** | Breadcrumb `London › Havering`; a new tile appends below. **Sub-second — no wait at all.** | `onAction` → ClickHouse → returns void. **Never touches the model.** The contrast with the 3s first answer is stark on camera. |
| **Type "What about Clapham?"** | Amber card: *"Which Clapham do you mean?"* — 5 chips. **Run suspends.** | The single most valuable 20 seconds of the demo — see below. |
| **Click Lambeth** | Run resumes, Lambeth tiles render. | `addToolOutput` wakes the suspended run. |
| **Refresh the page** | Conversation is still there. | The run is durable. |

#### Why the Clapham beat is the demo's centrepiece

It proves three things at once, in one interaction:

1. **The data really is this messy** — the biggest Clapham is in *Bedfordshire*, not London.
2. **We don't guess.** A naive agent silently returns Bedford and nobody notices it's wrong.
3. **The pause is Trigger.dev's HITL primitive doing its job** — unbilled, no concurrency slot, and
   `maxDuration` stops ticking. The user can take days.

#### Three UX decisions (made 17 Jul)

**1. Verdict: skeleton at the top, filled last.**
There's a real conflict — the model must *see* the data before it can conclude, so the verdict is
generated **last**; but a reader wants the conclusion **first**. A skeleton placeholder resolves it:
reading order stays correct, and the wait gains structure ("the answer is coming"), rather than the
user staring at charts wondering which one is the point. Cost: one more loading state to build.
*Rejected:* animating the verdict into the top afterwards (page jump, and the first 3s are
directionless); putting the verdict at the bottom (simplest, but it just doesn't answer the question).

**2. During the wait: show the tool calls, not a spinner.**
The model is the only slow part (~2–3s; ClickHouse is 50ms). Surfacing `Locating "London"… Querying
33 boroughs…` turns dead time into information — **and lets a judge watch the agent work**, which is
free credit on the 25% criterion. A spinner wastes that. Cost: the loop's steps must stream to the
frontend.

**3. Multi-turn: stack downward, one card group per turn.**
Like chat, but each "message" is a group of charts. Preserves exploration history, matches the
mental model of a chat agent, and matches `useChat`'s default.
*Rejected:* a replacing dashboard — loses history, and stops feeling like a chat agent, which risks
missing the brief.

#### Always on screen

- **Breadcrumbs** for the drill path
- **`rows scanned · query time` on every tile** — the most direct way to show a judge ClickHouse
  working
- **A stop button** while a turn is in flight (`stopSignal`; partial tiles are kept)

### 5.6 Dependencies — pinned, with a trap

**The AI SDK is required, not optional.** `chat.agent()` is *built on* the Vercel AI SDK — it's a
peer dependency you install yourself. The layering:

- **AI SDK = the model layer** — `streamText`, tool definitions, providers, streaming format, `useChat`
- **Trigger.dev = the runtime** — durability, transport, HITL suspension, actions, streams, scheduling

They interlock: `chat.toStreamTextOptions()` merges Trigger.dev telemetry + skills *into* `streamText`;
`useTriggerChatTransport` **is** an AI SDK `ChatTransport`; `.pipe(result.toUIMessageStream())`
consumes an AI SDK stream; the HITL no-`execute` tool is an AI SDK pattern Trigger.dev makes durable.
**What we don't need is Next.js API routes** — the transport replaces them.

**Version choice: `ai` v6.** Trigger.dev's compatibility matrix says *"v6 is what we develop against
day to day; v5 and v7 work too."* On a 15-day-old API, matching the maintainers' own version beats
being current.

**⚠️ The trap.** Docs say `@ai-sdk/react` "matches your `ai` major". **It does not.** Majors don't
line up — install by **dist-tag**, not by number:

| Package | `ai-v6` train | `latest` (pairs with ai@7) |
|---|---|---|
| `ai` | 6.0.229 | 7.0.30 |
| `@ai-sdk/react` | **3**.0.231 | 4.0.33 |
| `@ai-sdk/anthropic` | **3**.0.97 | 4.0.15 |

```bash
npm i @trigger.dev/sdk ai@ai-v6 @ai-sdk/react@ai-v6 @ai-sdk/anthropic@ai-v6 zod
```

- `@ai-sdk/otel` is **v7-only** — skip on v6 (v5/v6 emit spans from `ai` core directly)
- `@ai-sdk/react@ai-v6` React peer is oddly pinned: `^18 || ~19.0.1 || ~19.1.2 || ^19.2.1`
  — **constrains the Next.js version**; check on Day 1
- `useTriggerChatTransport` ships from `@trigger.dev/sdk/chat/react`; Realtime hooks from
  `@trigger.dev/react-hooks` (4.5.4)
- `@trigger.dev/sdk` must be `>=4.5.0` — that's where the chat agent surface lives

### 5.7 The viewSpec contract

**The critical distinction: the viewSpec is not LLM-generated.** The model only picks a tool and
fills its params; **our own deterministic tool code constructs the viewSpec** after the ClickHouse
query returns. It never passes through the model, so it cannot be hallucinated. This is a completely
different risk profile from "ask the LLM to emit chart JSON" — and it decides where validation goes.

**Three boundaries, three different guards:**

| Boundary | What's untrusted | Guard | Cost |
|---|---|---|---|
| LLM → tool params | **The model** | **Zod** — AI SDK validates and auto-retries the model on mismatch | Free, built into the SDK |
| tool code → viewSpec | Nothing | **TypeScript, compile-time** | Free; **no runtime validation needed** |
| server → client (JSON over streams) | **Version skew** | **Zod `safeParse`** | Near-free |

Only the third needs *runtime* validation — not because of hallucination, but because the viewSpec
is JSON-serialized through Trigger.dev streams and arrives as `unknown`. Deploy a new task while a
browser holds a stale bundle and you get an unknown tile: without parsing that's a white screen,
with it that's a graceful "can't render this tile" card.

**One Zod schema, two uses.** Zod is already a peer dep of `@trigger.dev/sdk` *and*
`@ai-sdk/anthropic` — it costs nothing.

```ts
// shared/view-spec.ts — single source of truth
export const ViewSpec = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("timeseries"),
    title: z.string(),
    points: z.array(z.object({ t: z.string(), v: z.number() })),
    drillTargets: z.array(DrillTarget),
    stats: z.object({ rowsRead: z.number(), elapsedMs: z.number() }),
  }),
  z.object({ kind: z.literal("comparison"),     /* ... */ }),
  z.object({ kind: z.literal("disambiguation"), /* the HITL tile */ }),
]);

export type ViewSpec = z.infer<typeof ViewSpec>;  // server constructs by type, client parses
```

**Rendering — let the compiler catch missing cases:**

```tsx
const RENDERERS = {
  timeseries: TimeseriesTile,
  comparison: ComparisonTile,
  disambiguation: DisambiguationTile,
} satisfies Record<ViewSpec["kind"], ComponentType<any>>;
```

The `satisfies` is the point: **add a new `kind` and forget its renderer, and TypeScript errors at
build time** rather than white-screening mid-demo. A whole bug class traded away for one keyword.

```tsx
const parsed = ViewSpec.safeParse(part);
if (!parsed.success) return <BrokenTile error={parsed.error} />;
const Tile = RENDERERS[parsed.data.kind];
return <Tile spec={parsed.data} />;
```

**The payoff — this is what makes it worth doing for a solo dev on 6.5 days.** Because the viewSpec
is pure data, **the entire visual layer can be built and verified on Day 1 from fixtures — no LLM,
no ClickHouse.** A `/gallery` route renders every `kind` from static fixtures. That buys:

1. **Decoupling** — the frontend doesn't wait on the agent. For one person, this is the only
   available parallelism.
2. **Fast iteration** — restyle a chart without running a model and a query each time.
3. **A test surface** — one fixture per kind is a snapshot-test suite.
4. **Demo insurance** — if the model misbehaves on recording day, the visual layer still works.

It also directly hedges **Risk 1**: if Day 2's `chat.agent()` spike goes badly, you still have a
working visual layer instead of nothing.

**Design choice: the spec carries data, not a query reference.** There are no API routes, so the
client has nowhere to fetch from — the tool already ran the query, and the result rides the stream
alongside the spec. Drill-down isn't a re-fetch; it's `onAction` back into the same run.

The precondition: **aggregate in ClickHouse, stream only small results.** A 467-district choropleth
is a few KB; raw rows would be a disaster. Trigger.dev's I/O packet limit is 128KB (streams are far
looser at 300MiB) — but "aggregate server-side, stream small" is the correct shape anyway, and it's
exactly what ClickHouse is for.

`drillTargets` lives in the spec so **the client needs no domain knowledge** to know what's
clickable. The renderer stays generic; housing knowledge stays in the tools.

---

## 6. Core agent flow — a tool loop, **not** a prompt chain

**This is not prompt chaining.** There is no "plan call" followed by an "execute call" followed by a
"verdict call". It is **one `streamText`, looping internally over tool steps**, with the model
deciding its own path:

```
[chat.agent run — ONE durable run per conversation, no API routes]

ONE system prompt  (chat.prompt.set in onChatStart — cacheable, dashboard-overridable)
  ↓
message → run() → streamText({ tools, stopWhen: stepCountIs(15) })
  ↓
  ┌─ TOOL LOOP — the AI SDK drives this; the model picks the steps ──────────┐
  │  step 1  resolvePlace("London")   → dictGet → result → back to model     │
  │            ambiguous? → disambiguatePlace (NO execute)                   │
  │                       → RUN SUSPENDS (unbilled, maxDuration stops)       │
  │                       → chip tile → user clicks → addToolOutput → RESUMES│
  │  step 2  compareAreas({...})      → ClickHouse → tile streams to UI      │
  │  step 3  emitVerdict({headline})  → verdict tile                         │
  │  → stopWhen                                                              │
  └──────────────────────────────────────────────────────────────────────────┘
  ↓
tile board renders; each tile carries its own drillTargets

action (drill click) → onAction → ClickHouse → tile → returns void → NO MODEL CALL
stop                 → stopSignal → onCancel persists partial tiles
refresh              → same run, conversation intact
```

Each step's tool result re-enters the prompt — compressed by `toModelOutput`, never the raw
ViewSpec (§5.3).

**Why a loop beats a chain here, and what we give up:**

- ✅ One fewer round trip — a chain would plan first, then execute.
- ✅ **The model adapts to what it finds.** It sees Lambeth is down 7% and can go ask why, unprompted.
  This is "progressive deepening" (Risk 4) for free — no extra machinery.
- ✅ It's what `chat.agent` is designed for.
- ❌ **We don't control how many tools it calls.** Could be one, could be eight. A chain is more
  controllable but more rigid.

**The verdict is the only text in the product**, and it's a headline — *"On £600k you're priced out
of 24 of 33 boroughs; here are the 9 that work"* — not prose. The brief's own example asks for "a
single verdict, not a forecast dump." Making it a tool (§5.3) is what enforces that.

> **Note:** the hackathon resources PDF links Trigger.dev's *"prompt chaining / routing /
> parallelization / orchestrator"* guides. Those are the **older `/guides/ai-agents` track** (plain
> `task()` + `generateText`). `chat.agent` does not use them. See §4.

---

## 7. Tooling: agent skills

Install both, **project-level** (`.claude/skills/` in this repo) — not into `~/claudecode/tx-skills/`.
Hackathon-specific; shouldn't pollute the global set or collide with existing symlinks.

- `npx skills add clickhouse/agent-skills` — schema design, query optimization, ingestion patterns
- Trigger.dev skills — task patterns, best practices

**Why this matters, concretely:** `chat.agent()` is **15 days old**. The assistant's training data
on it is effectively zero, and the first research pass had to be verified against npm and live docs
because memory was unreliable. Skills supply current, correct patterns. Per the "never build what
Trish can't explain" rule, this cuts both ways — skills produce *idiomatic* code, the kind that can
be explained.

---

## 8. Day by day

Each day ends with something that runs **end-to-end** (small vertical slices, per `CLAUDE.md`).

| Day | Work | Ends with |
|---|---|---|
| **1** (17 Jul) | Repo, MIT, skills installed, Next.js skeleton, **`ViewSpec` Zod schema + renderer registry + `/gallery` fixtures**, data loaded into ClickHouse Cloud with our own schema | **`/gallery` renders every tile kind from fixtures** — the whole visual layer, verified, with no LLM and no ClickHouse. Plus one hardcoded live query rendering one real chart. |
| **2** (18 Jul) | **`chat.agent()` spike** + `useTriggerChatTransport` + one ClickHouse tool + `emitVerdict` + `toModelOutput` + Streams v2 | Type a question → agent picks a tool → a real view streams in. **The whole product, thin.** <br>**Must-pass test:** ask 3 questions in a row; assert no ViewSpec JSON leaks into the turn-2/3 prompts (§5.3). |
| **3** (19 Jul) | Place-dictionary pipeline (`batch.triggerByTask` + idempotency) + resolver + **disambiguation as a no-`execute` HITL tool** | "Clapham" pauses the run, chips render, a click resumes it — resolving to Lambeth, not Bedford |
| **4** (20 Jul) | **The drill-down via `onAction`** — the differentiator, protected day | Click a tile → new tile, no model turn, sub-second |
| **5** (21 Jul) | Stop button (`stopSignal`), monthly `schedules.task()`, query-cost display, error/empty states, deploy | Live on Vercel |
| **6** (22 Jul) | **Feature freeze.** README + required "how CH/TD are used" writeup, demo video | **Submitted** |
| **7** (23 Jul) | Buffer only — see deadline risk | — |

Day 2 deliberately front-loads the riskiest new API so there's buffer if it bites.

---

## 9. Risks

### Risk 1 — `chat.agent()` is fifteen days old — **downgraded 17 Jul**

GA'd 2026-07-02; latest patch three days ago. No folk knowledge to fall back on. Taken deliberately:
it's the hackathon's headline ask, and Trigger.dev judges will reward depth on their newest platform.

**Downgraded on Day 1 for three reasons:**

1. **The API is verified real.** `chat.agent`, `toStreamTextOptions`, `createStopSignal`,
   `isStopped`, `useTriggerChatTransport` all import successfully.
2. **The docs are not thin — they ship in the package.** `node_modules/@trigger.dev/sdk/docs/` has
   **159 `.mdx` files**, of which **39 are `ai-chat/`** including 13 `patterns/`. 47 files mention
   `chat.agent`. These are *version-exact* — better than the website, which may drift from 4.5.4.
   (The installed *skills* don't cover the chat surface — that's not a gap, it's just not where
   Trigger.dev put this knowledge.)
3. **Two architecture assumptions are now verified against those docs:** HITL-via-no-`execute`-tool
   is exactly right; `onAction` works for drill-down (though it's designed for state mutation, so
   we're borrowing it — see NOTES-day1 §4.1b).

- *Mitigation:* **`mockChatAgent`** from `@trigger.dev/sdk/ai/test` — an offline harness that runs
  the real `run()` loop in an in-memory task runtime: *"no network, no task runtime, no mocking the
  SDK."* Pair with `MockLanguageModelV3` from `ai/test` to script the model. **This means the entire
  agent — tools, `toModelOutput`, the multi-turn loop, actions, stop signals — can be built and
  tested with zero credentials.** Day 2 is the spike; if it collapses, the `/guides/ai-agents`
  plain-`task()` track is the fallback.
  *(Correction: an earlier draft claimed `chat.local` was for local dev. Wrong — `chat.local` is
  run-scoped typed data, like AsyncLocalStorage. Read the docs, not the name.)*
- *Hedge:* the Day 1 `/gallery` fixtures (§5.7) mean the visual layer is already built and verified
  **before** the spike. Worst case we have a working product with a weaker backend, not nothing.

**Standing rule this produced:** read `node_modules` docs first, web second, memory last. Every
vendor here ships version-exact docs in-package (Trigger.dev 159, Next.js 423) precisely because
model training data goes stale. See `AGENTS.md`.

### Risk 2 — the deadline is ambiguous

- Handbook §5.3: "code freeze **00:00 AoE, 23 July**" → reads as the **start** of 23 July
- Resources PDF: "**23 July, midnight AoE**, build window closes" → reads as the **end**

**24 hours apart.** Plan submits 22 July and treats 23 July as pure buffer.

### Risk 3 — the map may not be free

`uk_price_paid` has **no coordinates** — only postcodes and place names. A choropleth needs UK
district boundaries from an external source (ONS publishes them). **The map is not a given.**

- *Mitigation:* visuals work on district names via bars and treemaps. Map lands only if the boundary
  join is clean and we're ahead.
- *Silver lining:* ingesting ONS centroids is another genuine scheduled-task story.

### Risk 4 — unverified Trigger.dev semantics to check empirically

Flagged by research as documented-by-absence or inferred:

- **Retry re-execution:** docs never state explicitly whether `run` restarts from the top on an
  *error* retry (vs resuming from a wait checkpoint). Strong circumstantial evidence it does.
  **Matters for the 7,726-item batch** — use `run`-scoped idempotency keys and verify.
- **Frontend cancel:** public access tokens are **read-scope only**; no documented write/cancel
  scope. A stop button likely must route through our own backend to `runs.cancel()`. `chat.agent()`
  ships `createStopSignal` / `isStopped`, which may supersede this — verify on Day 5.
- **Idempotency default scope changed** to `run` in v4.3.1+ (was `global`). Don't get bitten.

### Risk 5 — Anthropic API key needed

For the app itself — separate from the Claude Code subscription.

---

## 10. Open items

- [x] ~~Resolve `chat.agent()`~~ — **real, GA v4.5.0, 2026-07-02. Architecture rebuilt around it.**
- [ ] Load `uk_price_paid` into ClickHouse Cloud (long pole — nothing verifiable without it)
- [ ] Install ClickHouse + Trigger.dev agent skills (project-level)
- [ ] Anthropic API key for the app
- [ ] Project name (submission field, max 100 chars — placeholder fine until Day 6)

---

## 11. Submission checklist

- [ ] Public GitHub repo, MIT or Apache-2.0, public through judging
- [ ] Demo video ≤5 min, opens directly on the working product

#### Demo video shot list (derived from §5.5 — no intro, straight in)

| Time | Shot | The point it proves |
|---|---|---|
| 0:00 | Type the question, hit enter. Tool steps stream, tile lands, verdict fills in. | The answer is a chart, not a paragraph. |
| 0:45 | **Click a borough. Sub-second.** Then click again, and again. | Explorable, not decorative. The speed contrast vs the 3s first answer *is* the argument. |
| 1:20 | Type "Clapham" → suspend → 5 chips → **say out loud that the biggest one is in Bedfordshire** → click Lambeth → resumes. | The data is messy, we don't guess, and Trigger.dev's HITL is doing real work. |
| 2:00 | Point at `31.2M rows · 47ms` on a tile. | ClickHouse, visibly. |
| 2:20 | **Trigger.dev dashboard**: the run tree, the suspended HITL waitpoint, the monthly ingest, the 7,726-locality LLM batch with retries. | "Meaningful use" is judged in five minutes. Showing the machinery beats asserting it in a README. |
| 3:30 | Architecture in 60s: no API routes, the LLM never writes SQL and never sees a ViewSpec. | Technical implementation (20%). |
| 4:30 | Land the one-liner. | — |
- [ ] Project title (≤100 chars), tagline (≤160 chars), solution summary (≤500 words)
- [ ] Description of how ClickHouse and Trigger.dev are each used
- [ ] Name + email
- [ ] All code written inside the build window
- [ ] Submitted via the official form before code freeze

---

## 12. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Dataset | `uk_price_paid` | Only current dataset available; free drill-down tree |
| Team | Solo | — |
| Stack | Next.js + React + **AI SDK v6** | `chat.agent()` is built on the AI SDK — it's a peer dep, not optional. v6 because Trigger.dev "develop against it day to day" |
| Install by dist-tag | `ai@ai-v6`, `@ai-sdk/react@ai-v6`, … | Majors don't line up: ai@6 ↔ react@3 ↔ anthropic@3. `@latest` silently pairs with ai@7 |
| OLTP+OLAP bonus | **Skip** | Stay focused on the main rubric |
| Agent → SQL | Constrained tools | Demo reliability over flexibility |
| **Agent control flow** | **Tool loop, not prompt chain** (17 Jul) | One `streamText` + `stopWhen`; the model picks its own steps. Fewer round trips, and it adapts to what it finds — progressive deepening for free. Cost: we don't control how many tools it calls. |
| **The verdict** | **A tool (`emitVerdict`), not free text** | A system prompt saying "no prose" is a soft constraint the model *will* break. A tool leaves it no channel for prose. Makes the brief structurally enforced. |
| **Tool → model payload** | **`toModelOutput` compresses to one line** | Tool results enter the prompt. Raw ViewSpecs would bloat it and the cache prefix. Split: rendering data → frontend, decision data → model. The LLM never sees a ViewSpec. |
| Tool declaration site | On `chat.agent({ tools })`, read back from `run()` payload | Docs: config-less tools skip `toModelOutput` **from turn 2 onward** and stringify raw output into the prompt. A bug invisible in one-question testing. |
| ClickHouse instance | Our own Cloud, not playground | Owning the schema is what 25% rewards |
| Semantic layer | **Thin** — resolver + metrics + hierarchy | Full semantic model is a week; resolver is demo-critical |
| Place resolution — core | **Live SQL ambiguity check** (18 Jul) | Verified 836ms; no offline pipeline needed for the demo-critical path |
| Place resolution — enhancement | ClickHouse dictionary, LLM-built offline | Handles aliases/postcodes/misspellings. **Demoted to optional** — chat.agent carries the Trigger.dev story now |
| **Agent runtime** | **`chat.agent()`** (17 Jul) | GA 15 days before the hackathon — this event is its showcase. Trigger.dev *is* the backend; no API routes. |
| Pattern track | `/docs/ai-chat/*`, **not** `/guides/ai-agents` | Handbook names `chat.agent()`; the guides track is older |
| Disambiguation | No-`execute` tool (HITL pause) | The chip tile *is* Trigger.dev's HITL primitive |
| Drill-down | `onAction`, no model turn | First-class primitive for exactly this; sub-second |
| viewSpec author | **Tool code, never the LLM** | Can't be hallucinated; validation collapses to one boundary (server→client) |
| viewSpec validation | One Zod schema, `z.infer` for types, `safeParse` on the client only | Zod is already a peer dep; guards version skew, not hallucination |
| Renderer registry | `satisfies Record<ViewSpec["kind"], …>` | New kind without a renderer = **build error**, not a white screen |
| viewSpec payload | Carries data, not a query ref | No API routes to fetch from; aggregate in ClickHouse, stream small |
| Day 1 `/gallery` | Fixtures for every tile kind | Only parallelism available to a solo dev; hedges the Risk 1 spike |
| **Query-time fan-out** | **Dropped** (17 Jul) | ClickHouse answers in ~50ms — parallelism saves nothing |
| Offline batch fan-out | **Kept** | 7,726 slow LLM calls — genuinely parallel and expensive |
| Agent skills | Project-level install | Hackathon-specific; avoid polluting global tx-skills |
| **Scope direction** | **Deepen within one dataset, don't go cross-domain generic** (19 Jul) | After the first live run, one tool felt too limited. Root cause was "only 1 tool," not "it's about houses." The architecture (ViewSpec, tile renderer, chat.agent, constrained-tool pattern) is **already domain-agnostic** — only the tools are housing-specific. Add chart-kind tools (timeseries, distribution, extend compare); make generality a **pitch property** ("this pattern works for any dataset, here it's UK housing"), not a build target. A generic LLM-writes-SQL engine was rejected: it breaks invariant 5 (hallucination), loses the ClickHouse-depth story, and can't ship in 4 solo days. |

### 12.1 Open questions — decide before building the chart-kind tools (19 Jul)

Raised in a re-planning discussion; **not yet resolved**. Trish paused here.

1. **Breadth vs demo focus.** More tools = more user questions that hit an uncovered
   combination. Optimise for "answers many shapes" or "one rehearsed demo path + a few solid
   shapes"? Different bets for a hackathon.
2. **Place/level resolution ordering.** "Wigan" is a *district*, not a county — timeseries/
   distribution over "any place" need to know its level and parent. That's what the
   disambiguation-HITL slice solves. **Open: resolve places first, then add chart kinds? Or add
   chart kinds first and keep hitting the Wigan-style boundary?** *(Tentative lean: resolution
   first — even a pure-SQL version — so every later tool naturally eats "any place".)*
3. **"Lowest price" semantics.** The whole design is medians (a single cheapest sale is noise).
   Do we honour a literal `min`, or reframe to median-over-time? A product-values call: "true
   trend" vs "answer anything, even a misleading number".
4. **Demo climax.** Adding chart kinds widens capability but doesn't itself create a wow moment.
   What's the peak beat after deepening — a continuous compare → drill → timeline → distribution
   walk in one conversation, or something else?
