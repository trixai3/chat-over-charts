// Import order matters: the test harness installs the resource catalog that
// `chat.agent({ id })` registers into. It must load BEFORE the agent module
// (testing.mdx "Import order"), so this import stays first.
import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { houseAgent } from "./house-agent";

/**
 * A mock model scripted for a two-step turn:
 *   step 1 → call emitVerdict with the given headline
 *   step 2 → no tool call, finish with "stop" (the model is done)
 *
 * Without step 2 the tool loop would keep re-calling the model until
 * stepCountIs(15) trips. The per-call counter gives each step its own script.
 */
function verdictModel(headline: string) {
  let call = 0;
  const finish = (unified: "tool-calls" | "stop"): LanguageModelV3StreamPart => ({
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
  });

  return new MockLanguageModelV3({
    doStream: async () => {
      const chunks: LanguageModelV3StreamPart[] =
        call++ === 0
          ? [
              {
                type: "tool-call",
                toolCallId: "tc-1",
                toolName: "emitVerdict",
                // Raw args as the provider streams them: a JSON string the SDK
                // parses against inputSchema. Passing an object trips
                // tool-input-error before execute ever runs.
                input: JSON.stringify({ headline, tone: "good" }),
              },
              finish("tool-calls"),
            ]
          : [finish("stop")];
      return { stream: simulateReadableStream({ chunks }) };
    },
  });
}

function collectText(chunks: { type: string }[]): string {
  return chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => (c as unknown as { delta: string }).delta)
    .join("");
}

describe("houseAgent", () => {
  it("answers by emitting a verdict tile, never prose", async () => {
    const model = verdictModel("Havering rose fastest: +17.9% over 5 years.");
    const harness = mockChatAgent(houseAgent, {
      chatId: "verdict-1",
      clientData: { model },
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Which London borough rose fastest?" }],
      });

      // Invariant 1: no prose leaked into the chat stream.
      expect(collectText(turn.chunks)).toBe("");

      // The verdict tile — our VerdictSpec — reached the frontend.
      const streamed = JSON.stringify(turn.chunks);
      expect(streamed).toContain("Havering rose fastest: +17.9% over 5 years.");
      expect(streamed).toContain("verdict");
    } finally {
      await harness.close();
    }
  });
});
