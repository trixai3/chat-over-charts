import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { ClickHouseClient } from "@clickhouse/client";
import { houseAgent } from "./house-agent";
import { clickhouseKey } from "../src/shared/clickhouse";

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
    json: async () => [
      { district: "LAMBETH", median_price: 526890, transaction_count: 104000 },
      { district: "HAVERING", median_price: 445500, transaction_count: 98000 },
    ],
    query_id: "no-leak-uk",
    response_headers: {
      "x-clickhouse-summary": JSON.stringify({ read_rows: "4030464", elapsed_ns: "45000000" }),
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

function userMessage(text: string, id: string) {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

describe("cross-turn result compression", () => {
  it("keeps plans, SQL, ViewSpecs, and rendering data out of later model prompts", async () => {
    const model = scriptedModel([
      [toolCall("i1", "inspectAnalysis", request), finish("tool-calls")],
      [toolCall("r1", "renderAnalysis", request), finish("tool-calls")],
      [toolCall("v1", "emitVerdict", { headline: "Havering leads", tone: "good" }), finish("tool-calls")],
      [finish("stop")],
      [toolCall("v2", "emitVerdict", { headline: "Still Havering", tone: "neutral" }), finish("tool-calls")],
      [finish("stop")],
      [toolCall("v3", "emitVerdict", { headline: "As before", tone: "neutral" }), finish("tool-calls")],
      [finish("stop")],
    ]);
    const harness = mockChatAgent(houseAgent, {
      chatId: "no-leak-generic",
      clientData: { model },
      setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse),
    });

    try {
      await harness.sendMessage(userMessage(request.question, "u1"));
      const turn2 = model.doStreamCalls.length;
      await harness.sendMessage(userMessage("What is the conclusion?", "u2"));
      const turn3 = model.doStreamCalls.length;
      await harness.sendMessage(userMessage("And again?", "u3"));

      const prompt2 = JSON.stringify(model.doStreamCalls[turn2]!.prompt);
      expect(prompt2).toContain("READY");
      expect(prompt2).toContain("categories. First");
      expect(prompt2).not.toContain('"generatedSql"');
      expect(prompt2).not.toContain('"metricLabel"');
      expect(prompt2).not.toContain("quantileTDigest");

      const prompt3 = JSON.stringify(model.doStreamCalls[turn3]!.prompt);
      expect(prompt3).not.toContain('"generatedSql"');
      expect(prompt3).not.toContain('"explanation"');
    } finally {
      await harness.close();
    }
  });
});
