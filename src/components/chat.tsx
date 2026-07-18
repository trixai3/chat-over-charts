"use client";

import { useCallback, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
// Type-only: erased at compile, so no server-only agent code reaches the bundle.
// It just types the transport's task id and clientData against the real agent.
import type { houseAgent } from "../../trigger/house-agent";
import { mintChatAccessToken, startChatSession } from "@/app/actions";
import { Tile } from "@/components/tile-renderer";
import type { DrillTarget } from "@/shared/view-spec";

const EXAMPLES = [
  "Which London borough rose fastest?",
  "Compare districts in Greater Manchester by price",
  "Where is cheapest in West Yorkshire?",
];

/**
 * A message part carrying a finished tool result. Every one of our tools returns
 * a ViewSpec as its output, so `output` is exactly what the Tile renderer wants
 * — comparison and verdict alike. We don't trust the type here; Tile's safeParse
 * is the single validation boundary that turns bad data into a broken tile.
 */
function toolOutputs(parts: readonly unknown[]): unknown[] {
  return parts
    .filter((p): p is { type: string; state?: string; output?: unknown } => {
      if (typeof p !== "object" || p === null) return false;
      const part = p as { type?: unknown; state?: unknown; output?: unknown };
      return (
        typeof part.type === "string" &&
        part.type.startsWith("tool-") &&
        part.state === "output-available" &&
        part.output !== undefined
      );
    })
    .map((p) => p.output);
}

function messageText(parts: readonly unknown[]): string {
  return parts
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" && p !== null && (p as { type?: unknown }).type === "text",
    )
    .map((p) => p.text)
    .join("");
}

export function Chat() {
  const transport = useTriggerChatTransport<typeof houseAgent>({
    task: "house-agent",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) => startChatSession({ chatId, clientData }),
  });

  const { messages, sendMessage, stop, status } = useChat({ transport });
  const [input, setInput] = useState("");

  const submit = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q) return;
      sendMessage({ text: q });
      setInput("");
    },
    [sendMessage],
  );

  // Drill-down is Day 4 (onAction). Log for now so the wiring is visible.
  const onDrill = (t: DrillTarget) => console.log("drill:", t);

  const isStreaming = status === "streaming" || status === "submitted";
  const empty = messages.length === 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Beyond the Wall of Text</h1>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Ask about UK house prices. The answer is a chart, never a paragraph.
        </p>
      </header>

      {empty ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-black/40 dark:text-white/40">Try asking</p>
          {EXAMPLES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => submit(q)}
              className="rounded-lg border border-black/10 bg-black/[0.02] px-4 py-3 text-left text-sm transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
            >
              {q}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-6">
          {messages.map((m) => {
            if (m.role === "user") {
              return (
                <div key={m.id} className="self-end">
                  <div className="rounded-2xl bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">
                    {messageText(m.parts)}
                  </div>
                </div>
              );
            }
            const tiles = toolOutputs(m.parts);
            return (
              <div key={m.id} className="flex flex-col gap-4">
                {tiles.map((spec, i) => (
                  <Tile key={i} part={spec} onDrill={onDrill} onResolve={onDrill} />
                ))}
              </div>
            );
          })}
          {isStreaming && (
            <p className="animate-pulse text-xs text-black/40 dark:text-white/40">
              Thinking — running the tool loop…
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="sticky bottom-6 mt-8 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about UK house prices…"
          className="flex-1 rounded-full border border-black/15 bg-white px-5 py-3 text-sm outline-none focus:border-black/40 dark:border-white/15 dark:bg-black dark:focus:border-white/40"
        />
        {isStreaming ? (
          <button
            type="button"
            onClick={stop}
            className="rounded-full bg-rose-600 px-5 py-3 text-sm font-medium text-white"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            className="rounded-full bg-black px-6 py-3 text-sm font-medium text-white dark:bg-white dark:text-black"
          >
            Ask
          </button>
        )}
      </form>
    </main>
  );
}
