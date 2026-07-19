// Harness first — installs the resource catalog the agent registers into.
import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { ClickHouseClient } from "@clickhouse/client";
import { houseAgent } from "./house-agent";
import { clickhouseKey } from "../src/shared/clickhouse";

/**
 * The must-pass test (AGENTS.md invariant 3). A tool's `toModelOutput` compresses
 * its result before it re-enters the model's prompt. The failure mode is subtle:
 * it works on turn 1 (streamText applies it live) but, if tools aren't declared
 * on the agent config, is SKIPPED when history is re-converted from turn 2 on —
 * the raw ComparisonSpec JSON gets stringified back into the prompt, bloating
 * context and the cache prefix. Invisible with one question; fatal on camera.
 *
 * We declared tools on the config, so this asserts the fix holds: across three
 * turns, no model prompt ever contains raw spec field names — only the one-line
 * summary. Runs fully offline: a fake ClickHouse client via setupLocals, a
 * scripted mock model.
 */

// A fake ClickHouse client — same shape the tool uses (.query().json() +
// response_headers), returning the real numbers we verified in the playground.
const fakeClickHouse = {
  query: async () => ({
    json: async () => [
      { district: "BARKING AND DAGENHAM", latest_median: 380000, base_median: 325085, n: 73710 },
      { district: "HAVERING", latest_median: 440423, base_median: 389520, n: 122873 },
    ],
    response_headers: {
      "x-clickhouse-summary": JSON.stringify({ read_rows: "4030464", elapsed_ns: "355000000" }),
    },
  }),
} as unknown as ClickHouseClient;

function finishPart(unified: "tool-calls" | "stop"): LanguageModelV3StreamPart {
  return {
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
  };
}

// input must be a JSON string, not an object (slice-1 gotcha, NOTES-day2 §5).
function toolCall(id: string, name: string, input: unknown): LanguageModelV3StreamPart {
  return { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) };
}

/** A model that plays a fixed script of steps, one per doStream call. */
function scriptedModel(steps: LanguageModelV3StreamPart[][]) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      const chunks = steps[call++] ?? [finishPart("stop")];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

function userMsg(text: string, id: string) {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

describe("houseAgent multi-turn", () => {
  it("never leaks a raw ViewSpec into the model prompt from turn 2 on", async () => {
    const model = scriptedModel([
      // Turn 1: query, then verdict, then stop.
      [toolCall("c1", "compareAreas", { county: "Greater London" }), finishPart("tool-calls")],
      [toolCall("v1", "emitVerdict", { headline: "Barking rose fastest", tone: "good" }), finishPart("tool-calls")],
      [finishPart("stop")],
      // Turn 2: just a verdict — its prompt carries turn 1's compareAreas result.
      [toolCall("v2", "emitVerdict", { headline: "Still Barking", tone: "neutral" }), finishPart("tool-calls")],
      [finishPart("stop")],
      // Turn 3: another verdict — prompt carries both prior turns.
      [toolCall("v3", "emitVerdict", { headline: "As before", tone: "neutral" }), finishPart("tool-calls")],
      [finishPart("stop")],
    ]);

    const harness = mockChatAgent(houseAgent, {
      chatId: "no-leak-1",
      clientData: { model },
      setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse),
    });

    try {
      await harness.sendMessage(userMsg("Which London borough rose fastest?", "u1"));
      const t2Start = model.doStreamCalls.length;
      await harness.sendMessage(userMsg("And what stands out now?", "u2"));
      const t3Start = model.doStreamCalls.length;
      await harness.sendMessage(userMsg("Thanks!", "u3"));

      // The core assertion: turn 2's first model call carries turn 1's history.
      // The compareAreas result must be there COMPRESSED, not as raw spec JSON.
      const t2Prompt = JSON.stringify(model.doStreamCalls[t2Start]!.prompt);
      expect(t2Prompt).toContain("Scanned"); // the one-line summary IS present
      expect(t2Prompt).not.toContain('"metricLabel"'); // ...and the raw spec is NOT
      expect(t2Prompt).not.toContain('"drill"');

      // Same must hold on turn 3 (two prior turns of history).
      const t3Prompt = JSON.stringify(model.doStreamCalls[t3Start]!.prompt);
      expect(t3Prompt).not.toContain('"metricLabel"');

      // Belt and braces: no prompt, any turn, ever carries the raw ComparisonSpec.
      for (const c of model.doStreamCalls) {
        const p = JSON.stringify(c.prompt);
        expect(p).not.toContain('"kind":"comparison"');
        expect(p).not.toContain('"metricLabel"');
      }
    } finally {
      await harness.close();
    }
  });
});
