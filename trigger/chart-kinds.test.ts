// Harness first: it installs the resource catalog used by chat.agent.
import { mockChatAgent } from "@trigger.dev/sdk/ai/test";

import { describe, expect, it } from "vitest";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import type { ClickHouseClient } from "@clickhouse/client";
import { houseAgent } from "./house-agent";
import { clickhouseKey } from "../src/shared/clickhouse";
import { planAnalysis } from "../src/analysis/semantic-model";

/**
 * Coverage for the figure kinds and hybrid-resolver behaviour that landed
 * after house-agent.test.ts was written: pie/scatter/distribution rendering,
 * the deterministic pie-of-a-median refusal, and the aggregationNote-driven
 * average-price guardrail relayed through requestClarification.
 */

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

/** A fake ClickHouse client that returns canned rows regardless of the SQL sent. */
function fakeClickHouse(rows: unknown[], queryCapture?: string[]): ClickHouseClient {
  return {
    query: async ({ query }: { query: string }) => {
      queryCapture?.push(query);
      return {
        json: async () => rows,
        query_id: "chart-kinds-test",
        response_headers: {
          "x-clickhouse-summary": JSON.stringify({
            read_rows: "2500000",
            read_bytes: "80000000",
            elapsed_ns: "30000000",
          }),
        },
      };
    },
  } as unknown as ClickHouseClient;
}

// A tool's *actual* execute() return value, as opposed to the compressed
// toModelOutput text — this is what a real frontend renders as a tile.
function toolOutput(chunks: unknown[], toolCallId: string): unknown {
  const chunk = chunks.find(
    (item): item is { type: string; toolCallId: string; output: unknown } =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: string }).type === "tool-output-available" &&
      (item as { toolCallId?: string }).toolCallId === toolCallId,
  );
  return chunk?.output;
}

function toolInput(chunks: unknown[], toolCallId: string): unknown {
  const chunk = chunks.find(
    (item): item is { type: string; toolCallId: string; input: unknown } =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: string }).type === "tool-input-available" &&
      (item as { toolCallId?: string }).toolCallId === toolCallId,
  );
  return chunk?.input;
}

describe("chart kinds and the hybrid resolver", () => {
  it("renders a pie of an additive measure end to end", async () => {
    const request = {
      question: "Break down transactions by property type in Greater London",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["transactions"],
      dimensions: [{ field: "property type" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      preferredFigure: "pie",
    };
    const rows = [
      { property_type: "detached", transaction_count: 15000 },
      { property_type: "semi-detached", transaction_count: 22000 },
      { property_type: "terraced", transaction_count: 18000 },
      { property_type: "flat", transaction_count: 9000 },
    ];

    const model = scriptedModel([
      [toolCall("inspect-1", "inspectAnalysis", request), finish("tool-calls")],
      [toolCall("render-1", "renderAnalysis", request), finish("tool-calls")],
      [
        toolCall("verdict-1", "emitVerdict", {
          headline: "Semi-detached sales lead property types.",
          tone: "neutral",
        }),
        finish("tool-calls"),
      ],
      [finish("stop")],
    ]);
    const harness = mockChatAgent(houseAgent, {
      chatId: "pie-happy-path",
      clientData: { model },
      setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse(rows)),
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });

      const spec = toolOutput(turn.chunks, "render-1") as {
        kind: string;
        slices: Array<{ label: string; value: number }>;
      };
      expect(spec.kind).toBe("pie");
      expect(spec.slices).toEqual(
        expect.arrayContaining([
          { label: "detached", value: 15000 },
          { label: "semi-detached", value: 22000 },
          { label: "terraced", value: 18000 },
          { label: "flat", value: 9000 },
        ]),
      );

      const verdict = toolOutput(turn.chunks, "verdict-1") as { kind: string };
      expect(verdict.kind).toBe("verdict");
    } finally {
      await harness.close();
    }
  });

  it("refuses a pie of a median deterministically at inspectAnalysis, before any query runs", async () => {
    const request = {
      question: "Show median price by property type as a pie",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price"],
      dimensions: [{ field: "property type" }],
      filters: [],
      preferredFigure: "pie",
    };

    const model = scriptedModel([
      [toolCall("inspect-2", "inspectAnalysis", request), finish("tool-calls")],
      [
        toolCall("verdict-2", "emitVerdict", {
          headline: "A pie can't show a median honestly here; showing a comparison instead.",
          tone: "neutral",
        }),
        finish("tool-calls"),
      ],
      [finish("stop")],
    ]);
    // No renderAnalysis call is scripted, and the fake client would throw if
    // queried — the refusal must happen at inspectAnalysis, before any SQL.
    const harness = mockChatAgent(houseAgent, {
      chatId: "pie-of-median-refused",
      clientData: { model },
      setupLocals: ({ set }) =>
        set(clickhouseKey, {
          query: async () => {
            throw new Error("No query should run for an unsupported pie-of-median request.");
          },
        } as unknown as ClickHouseClient),
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });

      const plan = toolOutput(turn.chunks, "inspect-2") as {
        status: string;
        suggestions: string[];
      };
      expect(plan.status).toBe("unsupported");
      expect(plan.suggestions).toContain("comparison");

      const chunks = JSON.stringify(turn.chunks);
      expect(chunks).not.toContain('"kind":"pie"');
    } finally {
      await harness.close();
    }
  });

  it("renders a distribution of price in one district", async () => {
    const request = {
      question: "How are prices distributed in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "distribution",
      measures: ["price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
    };
    const rows = [
      {
        bins: [
          [100000, 200000, 120],
          [200000, 350000, 340],
          [350000, 600000, 210],
        ],
        median_price: 526890,
      },
    ];
    const queries: string[] = [];

    const model = scriptedModel([
      [toolCall("inspect-3", "inspectAnalysis", request), finish("tool-calls")],
      [toolCall("render-3", "renderAnalysis", request), finish("tool-calls")],
      [
        toolCall("verdict-3", "emitVerdict", {
          headline: "Lambeth prices cluster below £350k, with a £526,890 median.",
          tone: "neutral",
        }),
        finish("tool-calls"),
      ],
      [finish("stop")],
    ]);
    const harness = mockChatAgent(houseAgent, {
      chatId: "distribution-happy-path",
      clientData: { model },
      setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse(rows, queries)),
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });

      const spec = toolOutput(turn.chunks, "render-3") as {
        kind: string;
        bins: Array<{ from: number; to: number; count: number }>;
        median?: number;
      };
      expect(spec.kind).toBe("distribution");
      expect(spec.bins).toHaveLength(3);
      expect(spec.median).toBe(526890);

      expect(queries.some((sql) => sql.includes("histogramIf(20)("))).toBe(true);
    } finally {
      await harness.close();
    }
  });

  it("relays the right-skew guardrail for average price, without a query running", async () => {
    // Compute the guardrail's actual question through the semantic layer
    // (rather than hand-authoring it) so the test fails if the aggregationNote
    // wiring or the guardrail's wording regresses.
    const plan = planAnalysis({
      question: "What's the average house price in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["average price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });
    if (plan.status !== "needs_clarification") throw new Error("expected a clarification plan");
    const ambiguity = plan.ambiguities[0]!;
    expect(ambiguity.question).toContain("right-skewed");
    expect(ambiguity.recommended).toBe("median_price");

    const request = {
      question: "What's the average house price in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["average price"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
    };
    const model = scriptedModel([
      [toolCall("inspect-4", "inspectAnalysis", request), finish("tool-calls")],
      [
        toolCall("clarify-4", "requestClarification", {
          field: ambiguity.field,
          question: ambiguity.question,
          options: ambiguity.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            recommended: option.id === ambiguity.recommended,
          })),
        }),
        finish("tool-calls"),
      ],
    ]);
    const harness = mockChatAgent(houseAgent, {
      chatId: "average-price-guardrail",
      clientData: { model },
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });

      const clarificationInput = toolInput(turn.chunks, "clarify-4") as { question: string };
      expect(clarificationInput.question).toContain("right-skewed");
      expect(clarificationInput.question).toContain("Median sale price");

      const chunks = JSON.stringify(turn.chunks);
      expect(chunks).not.toContain("renderAnalysis");
    } finally {
      await harness.close();
    }
  });

  it("does not mention median or right-skewed when the mismatched aggregation isn't the median measure", async () => {
    const plan = planAnalysis({
      question: "What's the average number of transactions in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["average transactions"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
      orderBy: [],
    });
    if (plan.status !== "needs_clarification") throw new Error("expected a clarification plan");
    const ambiguity = plan.ambiguities[0]!;
    expect(ambiguity.question).not.toMatch(/median/i);
    expect(ambiguity.question).not.toMatch(/right-skewed/i);
    expect(ambiguity.recommended).toBe("transaction_count");

    const request = {
      question: "What's the average number of transactions in Lambeth?",
      sourceId: "uk-house-prices",
      analysisType: "single_value",
      measures: ["average transactions"],
      dimensions: [],
      filters: [{ field: "district", operator: "equals", value: "Lambeth" }],
    };
    const model = scriptedModel([
      [toolCall("inspect-5", "inspectAnalysis", request), finish("tool-calls")],
      [
        toolCall("clarify-5", "requestClarification", {
          field: ambiguity.field,
          question: ambiguity.question,
          options: ambiguity.options.map((option) => ({
            id: option.id,
            label: option.label,
            description: option.description,
            recommended: option.id === ambiguity.recommended,
          })),
        }),
        finish("tool-calls"),
      ],
    ]);
    const harness = mockChatAgent(houseAgent, {
      chatId: "average-transactions-no-median-copy",
      clientData: { model },
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });

      const clarificationInput = toolInput(turn.chunks, "clarify-5") as { question: string };
      expect(clarificationInput.question).not.toMatch(/median/i);
      expect(clarificationInput.question).not.toMatch(/right-skewed/i);
    } finally {
      await harness.close();
    }
  });

  it("renders a scatter of two measures across one category dimension", async () => {
    const request = {
      question: "Plot median price against transactions by district in Greater London",
      sourceId: "uk-house-prices",
      analysisType: "category_comparison",
      measures: ["median price", "transactions"],
      dimensions: [{ field: "district" }],
      filters: [{ field: "county", operator: "equals", value: "Greater London" }],
      preferredFigure: "scatter",
    };
    const rows = [
      { district: "LAMBETH", median_price: 526890, transaction_count: 15000 },
      { district: "HAVERING", median_price: 445500, transaction_count: 9800 },
      { district: "CAMDEN", median_price: 650000, transaction_count: 7000 },
    ];

    const model = scriptedModel([
      [toolCall("inspect-6", "inspectAnalysis", request), finish("tool-calls")],
      [toolCall("render-6", "renderAnalysis", request), finish("tool-calls")],
      [
        toolCall("verdict-6", "emitVerdict", {
          headline: "Camden has the highest median price among these districts.",
          tone: "neutral",
        }),
        finish("tool-calls"),
      ],
      [finish("stop")],
    ]);
    const harness = mockChatAgent(houseAgent, {
      chatId: "scatter-happy-path",
      clientData: { model },
      setupLocals: ({ set }) => set(clickhouseKey, fakeClickHouse(rows)),
    });

    try {
      const turn = await harness.sendMessage({
        id: "u1",
        role: "user",
        parts: [{ type: "text", text: request.question }],
      });

      const spec = toolOutput(turn.chunks, "render-6") as {
        kind: string;
        points: Array<{ label: string; x: number; y: number }>;
      };
      expect(spec.kind).toBe("scatter");
      expect(spec.points).toEqual(
        expect.arrayContaining([
          { label: "LAMBETH", x: 526890, y: 15000 },
          { label: "HAVERING", x: 445500, y: 9800 },
          { label: "CAMDEN", x: 650000, y: 7000 },
        ]),
      );
    } finally {
      await harness.close();
    }
  });
});
