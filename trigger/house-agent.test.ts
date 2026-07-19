// Harness first: it installs the resource catalog used by chat.agent.
import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { ClickHouseClient } from "@clickhouse/client";
import { houseAgent } from "./house-agent";
import { clickhouseKey } from "../src/shared/clickhouse";
import { analysisTools } from "../src/agent/tools";

const request = {
  question: "Which London borough rose fastest?",
  sourceId: "uk-house-prices",
  analysisType: "category_comparison",
  measures: ["latest median price", "five year growth"],
  dimensions: [{ field: "borough" }],
  filters: [{ field: "county", operator: "equals", value: "Greater London" }],
  orderBy: [{ field: "five year growth", direction: "desc" }],
};

const fakeClickHouse = {
  query: async () => ({
    json: async () => [
      { district: "HAVERING", latest_median_price: 445500, five_year_price_change_pct: 17.9 },
      { district: "LAMBETH", latest_median_price: 526890, five_year_price_change_pct: -7.2 },
    ],
    query_id: "agent-uk-test",
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

describe("governed analysis agent", () => {
  it("exposes workflow tools, not chart-specific tools", () => {
    expect(Object.keys(analysisTools)).toEqual([
      "inspectAnalysis",
      "requestClarification",
      "renderAnalysis",
      "emitVerdict",
    ]);
    expect(Object.keys(analysisTools)).not.toContain("compareAreas");
  });

  it("streams a UK house-price figure and verdict without prose", async () => {
    const model = scriptedModel([
      [toolCall("inspect-1", "inspectAnalysis", request), finish("tool-calls")],
      [toolCall("render-1", "renderAnalysis", request), finish("tool-calls")],
      [
        toolCall("verdict-1", "emitVerdict", {
          headline: "Havering rose fastest: +17.9% over five years.",
          tone: "good",
        }),
        finish("tool-calls"),
      ],
      [finish("stop")],
    ]);
    const harness = mockChatAgent(houseAgent, {
      chatId: "governed-figure-1",
      clientData: { model },
      setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse),
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });
      const chunks = JSON.stringify(turn.chunks);
      expect(turn.chunks.filter((chunk) => chunk.type === "text-delta")).toHaveLength(0);
      expect(chunks).toContain('"kind":"comparison"');
      expect(chunks).toContain("HM Land Registry Price Paid Data");
      expect(chunks).toContain("Havering rose fastest");
    } finally {
      await harness.close();
    }
  });
});
