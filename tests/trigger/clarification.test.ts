import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { houseAgent } from "../../trigger/house-agent";

function finish(): LanguageModelV3StreamPart {
  return {
    type: "finish",
    finishReason: { unified: "tool-calls", raw: "tool-calls" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 10, text: 10, reasoning: undefined },
    },
  };
}

describe("governed clarification", () => {
  it("ends on a pending no-execute tool with supported choices", async () => {
    let call = 0;
    const model = new MockLanguageModelV3({
      doStream: async () => {
        const chunks: LanguageModelV3StreamPart[] = call++ === 0
          ? [
              {
                type: "tool-call",
                toolCallId: "inspect-ambiguous",
                toolName: "inspectAnalysis",
                input: JSON.stringify({
                  question: "Show happiness by district",
                  sourceId: "uk-house-prices",
                  analysisType: "category_comparison",
                  measures: ["happiness"],
                  dimensions: [{ field: "district" }],
                  filters: [],
                  orderBy: [],
                }),
              },
              finish(),
            ]
          : [
              {
                type: "tool-call",
                toolCallId: "clarify-measure",
                toolName: "requestClarification",
                input: JSON.stringify({
                  field: "measures",
                  question: "Which governed measure should be used?",
                  options: [
                    { id: "median_price", label: "Median sale price", recommended: true },
                    { id: "transaction_count", label: "Transactions" },
                  ],
                }),
              },
              finish(),
            ];
        return { stream: simulateReadableStream({ chunks }) };
      },
    });
    const harness = mockChatAgent(houseAgent, {
      chatId: "clarification-1",
      clientData: { model },
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: "Show happiness by district" }],
      });
      const chunks = JSON.stringify(turn.chunks);
      expect(chunks).toContain("requestClarification");
      expect(chunks).toContain("Which governed measure should be used?");
      expect(chunks).not.toContain("renderAnalysis");
    } finally {
      await harness.close();
    }
  });
});
