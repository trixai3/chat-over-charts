// Harness first: it installs the resource catalog used by chat.agent.
import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { ClickHouseClient } from "@clickhouse/client";
import { houseAgent } from "./house-agent";
import { clickhouseKey } from "../src/shared/clickhouse";
import { registerSemanticModel } from "../src/analysis/semantic-model";
import type { SemanticModel } from "../src/analysis/types";

const supportTickets: SemanticModel = {
  id: "support-tickets-binding",
  label: "Support tickets",
  adapter: "clickhouse",
  database: "test",
  table: "tickets",
  sourceSystem: "Test fixture",
  lastRefresh: "2026-07-19",
  version: "1.0.0",
  figurePolicyVersion: "1.0.0",
  defaults: { measure: "ticket_count", timeDimension: "created_date", timeGrain: "month" },
  measures: {
    ticket_count: {
      id: "ticket_count",
      label: "Tickets",
      description: "Number of tickets.",
      expression: "count()",
      format: { style: "number", maximumFractionDigits: 0 },
      aggregation: "count",
      version: "1.0.0",
      synonyms: ["tickets", "volume"],
      limitations: [],
    },
  },
  dimensions: {
    created_date: {
      id: "created_date",
      label: "Created date",
      description: "Ticket creation date.",
      expression: "created_at",
      kind: "time",
      synonyms: ["date", "time"],
      grains: { month: "toStartOfMonth(created_at)" },
    },
    priority: {
      id: "priority",
      label: "Priority",
      description: "Ticket priority.",
      expression: "priority",
      kind: "category",
      synonyms: ["priority"],
    },
  },
};

// Not exercised by these tests (describeData runs no SQL), but setupLocals
// always seeds it — mirrors house-agent.test.ts so the harness shape matches.
const fakeClickHouse = {
  query: async () => ({
    json: async () => [],
    query_id: "source-binding-test",
    response_headers: {
      "x-clickhouse-summary": JSON.stringify({
        read_rows: "0",
        read_bytes: "0",
        elapsed_ns: "0",
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

describe("source binding", () => {
  it("the bound source, not a default, decides the catalog", async () => {
    const remove = registerSemanticModel(supportTickets);
    try {
      const model = scriptedModel([
        [toolCall("catalog-1", "describeData", {}), finish("tool-calls")],
        [
          toolCall("verdict-1", "emitVerdict", {
            headline: "One measure across two dimensions of tickets is available.",
            tone: "neutral",
          }),
          finish("tool-calls"),
        ],
        [finish("stop")],
      ]);
      const harness = mockChatAgent(houseAgent, {
        chatId: "source-binding-1",
        clientData: { model, sourceId: supportTickets.id },
        setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse),
      });

      try {
        const turn = await harness.sendMessage({
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "What data do you have?" }],
        });
        const chunks = JSON.stringify(turn.chunks);
        expect(chunks).toContain("Tickets");
        expect(chunks).not.toContain("Median sale price");
      } finally {
        await harness.close();
      }
    } finally {
      remove();
    }
  });

  it("the model cannot override the bound source", async () => {
    const remove = registerSemanticModel(supportTickets);
    try {
      const model = scriptedModel([
        [
          // The model supplies a sourceId anyway — the schema no longer
          // declares the field, so Zod strips it before execute ever runs.
          toolCall("catalog-1", "describeData", { sourceId: "uk-house-prices" }),
          finish("tool-calls"),
        ],
        [
          toolCall("verdict-1", "emitVerdict", {
            headline: "One measure across two dimensions of tickets is available.",
            tone: "neutral",
          }),
          finish("tool-calls"),
        ],
        [finish("stop")],
      ]);
      const harness = mockChatAgent(houseAgent, {
        chatId: "source-binding-2",
        clientData: { model, sourceId: supportTickets.id },
        setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse),
      });

      try {
        const turn = await harness.sendMessage({
          id: "u1",
          role: "user",
          parts: [{ type: "text", text: "What data do you have?" }],
        });
        const chunks = JSON.stringify(turn.chunks);
        expect(chunks).toContain("Tickets");
        expect(chunks).not.toContain("Median sale price");
      } finally {
        await harness.close();
      }
    } finally {
      remove();
    }
  });
});
