<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Beyond the Wall of Text — agent guide

Hackathon entry: ClickHouse × Trigger.dev, 17–23 July 2026. A chat agent for UK house prices where
**the response is a chart you can drill into, never a paragraph.**

Read [PLAN.md](PLAN.md) before making architectural decisions. It records what was decided *and why*,
including ideas that were tried and dropped.

## The rule that overrides everything

**Never build what Trish can't explain herself.** Teach each internal — what it does, why it's built
this way, what the alternatives were. Small vertical slices. Plan before code. No big PRs.

If a change can't be explained in a sentence, it's the wrong change.

## This entire stack is newer than your training data

This bit us three times in one day. Assume your memory is wrong and check:

| Thing | Reality |
|---|---|
| `chat.agent()` | GA'd **2026-07-02** — 15 days before the hackathon. Zero folk knowledge. |
| AI SDK majors | `ai@6` pairs with `@ai-sdk/react@3`, **not** `@ai-sdk/react@6` |
| Next.js 16 | See the block at the top of this file |

**Verify against docs, not memory.** When research contradicts what you "know", research wins.

## 📚 Read the docs shipped in node_modules — they are the authority

Every vendor here ships **version-exact docs inside the npm package**. This is the whole point:
their docs travel with the version you installed, so they can't be stale the way your training data
and the public website both can be. **Check here first, before the web, before your memory.**

| Source | Location | Size |
|---|---|---|
| **Trigger.dev** | `node_modules/@trigger.dev/sdk/docs/` | **159 `.mdx`** |
| ↳ the chat agent surface | `node_modules/@trigger.dev/sdk/docs/ai-chat/` | **39 files**, incl. 13 `patterns/` |
| **Next.js 16** | `node_modules/next/dist/docs/` | 423 files |
| **ClickHouse** | `.agents/skills/` and `node_modules/@clickhouse/client/skills/` | 17 skills |

Most relevant to this build:

- `ai-chat/quick-start.mdx`, `anatomy.mdx`, `backend.mdx`, `frontend.mdx`, `tools.mdx`, `types.mdx`
- `ai-chat/actions.mdx` — the drill-down mechanism
- `ai-chat/patterns/human-in-the-loop.mdx` — the disambiguation tile
- `ai-chat/reference.mdx` — the AI SDK compatibility matrix
- `ai-chat/testing.mdx`, `chat-local.mdx` — local dev without deploying

⚠️ **The installed Trigger.dev *skills* do NOT cover `chat.agent()`** — verified, zero hits for
`chat.agent` / `sdk/ai` / `toStreamTextOptions` / `useTriggerChatTransport`. They document the older
`/guides/ai-agents` track (plain `task()` + `generateText`), and are current only for Streams v2.
**This is not a gap** — Trigger.dev ships that knowledge as the packaged docs above (47 files
mention `chat.agent`), not as skills. Use the docs; don't trust the skills on the chat surface.

## Architecture invariants — don't break these

1. **The agent never returns prose.** Tools return a typed `ViewSpec`. The only text in the product
   is a one-line verdict headline. If an answer becomes a paragraph, the brief is missed.
2. **The LLM does not author ViewSpecs.** It picks a tool and fills params (Zod-validated by the AI
   SDK). Our own tool code constructs the spec after the query returns. This is why specs can't be
   hallucinated.
3. **The LLM does not write SQL.** Constrained tools only. A demo that hallucinates a column name is
   a dead demo.
4. **Exactly one runtime validation boundary**: `ViewSpec.safeParse` on the client, in
   `tile-renderer.tsx`. It guards version skew, not hallucination. Don't add validation elsewhere.
5. **No Next.js API routes.** `chat.agent()` + `useTriggerChatTransport` replace them. Adding a
   route means the architecture was misunderstood.
6. **Drill-down never calls the LLM.** It goes through `onAction` on the same durable run.
7. **Aggregate in ClickHouse; stream small results.** Specs carry data, not query references. Never
   stream raw rows.

## Version pinning

Install AI SDK packages by **dist-tag**:

```bash
npm i ai@ai-v6 @ai-sdk/react@ai-v6 @ai-sdk/anthropic@ai-v6
```

`@latest` silently pairs with `ai@7`. `@ai-sdk/otel` is v7-only — do not add it on v6.

## Adding a new tile kind

1. Add the variant to the discriminated union in `src/shared/view-spec.ts`
2. Write the renderer in `src/components/tiles/`
3. Register it in `RENDERERS` in `tile-renderer.tsx`
4. Add a fixture to `src/shared/fixtures.ts`

Skip step 3 and the build fails — `satisfies Record<ViewSpecKind, …>` is load-bearing, not
decoration. That's deliberate: it turns a mid-demo white screen into a compile error.

## Fixtures use real data, on purpose

Every number in `fixtures.ts` came from the ClickHouse playground. `/gallery` is a dry run of the
demo — fake data hides layout and distribution problems (e.g. the right skew that justifies using
medians). Keep it that way.

## Conventions

- Comments state constraints the code can't show. Never narrate what the next line does.
- Metrics are **medians** (`quantileTDigest`), never averages — house prices are heavily
  right-skewed and `avg(price)` is a lie. Define it once in the metrics registry.
- Every tile shows rows scanned + query time. It's how a judge sees ClickHouse working.

## Don't

- Don't add query-time parallel fan-out. ClickHouse answers in ~50ms; it saves nothing and weakens
  the pitch. (Offline LLM batching over ambiguous place names is different — that one is justified.)
- Don't use `metadata.stream()` — deprecated in SDK 4.1.0. Use `streams.define()`.
- Don't commit `.env.local`. `.env.example` is the template and *is* committed.
- Don't guess place names. 62% of localities span multiple districts; "Clapham" resolves to 11
  places across 6 counties and the biggest is in Bedfordshire. Ambiguity emits a disambiguation
  tile, which suspends the run (HITL) until the user picks.
