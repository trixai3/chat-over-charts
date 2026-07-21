# Beyond the Wall of Text

**Chat with your data and get answers as governed figures, not paragraphs — shown here on UK house prices.**

Built for the [ClickHouse × Trigger.dev Virtual Summer Hackathon 2026](https://triggerdev.clickhouse.com).

> Status: **Day 1 of 7.** See [PLAN.md](PLAN.md) for the architecture and [NOTES-day1.md](NOTES-day1.md) for build notes.

---

## The idea

Ask "where can I actually afford to live?" and every other chat agent hands you a wall of text.
This one never returns prose. It returns a **typed view spec** that renders as a chart — and every
chart is a live query surface: click a borough and it re-queries ClickHouse and drills a level down
the geography tree.

The only text the product produces is a single headline verdict.

## How ClickHouse and Trigger.dev are used

**ClickHouse** is the primary database — 31M Land Registry sales (1995 → Mar 2026), loaded into our
own Cloud service with our own schema, ORDER BY key, and materialized views. It also backs place
resolution via a dictionary (`dictGet`).

**Trigger.dev** is not orchestration bolted on the side — it *is* the backend. `chat.agent()` runs
each conversation as one long-lived durable task; there are **no Next.js API routes**. It also runs
the offline pipeline: monthly ingestion, and an LLM batch that disambiguates 7,726 ambiguous place
names into a ClickHouse dictionary.

See [PLAN.md](PLAN.md) §5.4 for the full capability map.

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
npm run dev
```

- `/gallery` — every tile kind rendered from fixtures. No LLM, no ClickHouse needed.

## License

MIT — see [LICENSE](LICENSE).
