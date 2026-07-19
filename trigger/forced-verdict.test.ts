// Harness first: it installs the resource catalog used by chat.agent.
import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { ClickHouseClient } from "@clickhouse/client";
import { houseAgent } from "./house-agent";
import { clickhouseKey } from "../src/shared/clickhouse";

/**
 * Covers the mechanical termination guarantee added to house-agent.ts:
 * `prepareStep` forces `emitVerdict` on the final allowed step
 * (stepNumber === 14, i.e. the 15th call — stepCountIs(15) stops the loop
 * once 15 steps have completed, and prepareStep sees `stepNumber` as the
 * count of steps completed *before* the step about to run).
 *
 * "Finish every turn with emitVerdict" is otherwise only a system-prompt
 * instruction; these tests script an adversarial model that ignores it, and
 * check the actual request options sent on each `doStream` call rather than
 * whether the (fake) model complies — that's the only thing our code
 * controls.
 */

const request = {
  question: "Which London borough has the highest median price?",
  sourceId: "uk-house-prices",
  analysisType: "category_comparison",
  measures: ["median price", "transactions"],
  dimensions: [{ field: "borough" }],
  filters: [{ field: "county", operator: "equals", value: "Greater London" }],
  orderBy: [{ field: "median price", direction: "desc" }],
};

const fakeClickHouse = {
  query: async () => ({
    json: async () => [{ district: "LAMBETH", median_price: 526890, transaction_count: 104000 }],
    query_id: "forced-verdict-test",
    response_headers: {
      "x-clickhouse-summary": JSON.stringify({
        read_rows: "4030464",
        read_bytes: "120000000",
        elapsed_ns: "45000000",
      }),
    },
  }),
} as unknown as ClickHouseClient;

function finish(unified: "tool-calls" | "stop"): LanguageModelV3StreamPart {
  return {
    type: "finish",
    finishReason: { unified, raw: unified },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
  };
}

function toolCall(id: string, toolName: string, input: unknown): LanguageModelV3StreamPart {
  return { type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) };
}

function scriptedModel(steps: LanguageModelV3StreamPart[][]) {
  let call = 0;
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: steps[call++] ?? [finish("stop")] }),
    }),
  });
}

const STEP_BUDGET = 15;
const FORCED_TOOL_CHOICE = { type: "tool", toolName: "emitVerdict" };

describe("forced verdict on the final step", () => {
  it("forces emitVerdict on the final allowed step when the model never volunteers one", async () => {
    // Adversarial: calls inspectAnalysis on every single step, including the
    // one where our prepareStep forces toolChoice/activeTools to emitVerdict.
    // Tool execution always uses the full (unfiltered) tool set (ai@6
    // streamText, node_modules/ai/dist/index.js ~L7783-7805), so this script
    // executes cleanly step after step without ever calling emitVerdict.
    const steps: LanguageModelV3StreamPart[][] = Array.from({ length: STEP_BUDGET }, (_, i) => [
      toolCall(`inspect-${i}`, "inspectAnalysis", request),
      finish("tool-calls"),
    ]);
    const model = scriptedModel(steps);
    const harness = mockChatAgent(houseAgent, {
      chatId: "forced-verdict-never",
      clientData: { model },
      setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse),
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });

      // The turn ends exactly at the step budget — stepCountIs(15) still
      // governs termination; forcing emitVerdict doesn't change that.
      expect(turn.chunks.length).toBeGreaterThan(0);
      expect(model.doStreamCalls).toHaveLength(STEP_BUDGET);

      // Every step before the last one is unforced (auto/whatever the base
      // prepareStep set — never the emitVerdict-only restriction).
      for (let i = 0; i < STEP_BUDGET - 1; i++) {
        expect(model.doStreamCalls[i]?.toolChoice).not.toEqual(FORCED_TOOL_CHOICE);
      }

      // The final call (stepNumber === 14, the 15th call) is forced.
      const finalCall = model.doStreamCalls[STEP_BUDGET - 1];
      expect(finalCall?.toolChoice).toEqual(FORCED_TOOL_CHOICE);
      expect(finalCall?.tools?.map((tool) => tool.name)).toEqual(["emitVerdict"]);
    } finally {
      await harness.close();
    }
  });
});
