"use client";

import { useCallback, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { houseAgent } from "../../trigger/house-agent";
import { mintChatAccessToken, startChatSession } from "@/app/actions";
import { Tile } from "@/components/tile-renderer";
import type { SourceOption } from "@/analysis/source-options";

/** Only presentation tools produce ViewSpecs; planning output stays invisible. */
function toolOutputs(parts: readonly unknown[]): unknown[] {
  return parts
    .filter((part): part is { type: string; state?: string; output?: unknown } => {
      if (typeof part !== "object" || part === null) return false;
      const candidate = part as { type?: unknown; state?: unknown; output?: unknown };
      return (
        (candidate.type === "tool-renderAnalysis" ||
          candidate.type === "tool-explainSemantics" ||
          candidate.type === "tool-describeData" ||
          candidate.type === "tool-emitVerdict") &&
        candidate.state === "output-available" &&
        candidate.output !== undefined
      );
    })
    .map((part) => part.output);
}

type PendingClarification = {
  toolCallId: string;
  field: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
};

function pendingClarifications(parts: readonly unknown[]): PendingClarification[] {
  return parts.flatMap((part) => {
    if (typeof part !== "object" || part === null) return [];
    const candidate = part as {
      type?: unknown;
      state?: unknown;
      toolCallId?: unknown;
      input?: unknown;
    };
    if (
      candidate.type !== "tool-requestClarification" ||
      candidate.state !== "input-available" ||
      typeof candidate.toolCallId !== "string" ||
      typeof candidate.input !== "object" ||
      candidate.input === null
    ) return [];

    const input = candidate.input as { field?: unknown; question?: unknown; options?: unknown };
    if (
      typeof input.field !== "string" ||
      typeof input.question !== "string" ||
      !Array.isArray(input.options)
    ) return [];
    const options = input.options.filter(
      (option): option is PendingClarification["options"][number] =>
        typeof option === "object" &&
        option !== null &&
        typeof (option as { id?: unknown }).id === "string" &&
        typeof (option as { label?: unknown }).label === "string",
    );
    return [{
      toolCallId: candidate.toolCallId,
      field: input.field,
      question: input.question,
      options,
    }];
  });
}

/**
 * The run's progress, read straight from the streamed tool parts — each tool
 * call IS a pipeline stage, so no extra progress channel is needed.
 */
const ACTIVITY_STEPS: Record<string, { active: string; done: string }> = {
  "tool-inspectAnalysis": {
    active: "Resolving semantics…",
    done: "Semantic plan ready · deciding next step…",
  },
  "tool-requestClarification": {
    active: "Preparing a clarification…",
    done: "Waiting for your choice…",
  },
  "tool-renderAnalysis": {
    active: "Querying ClickHouse · validating dataset…",
    done: "Figure rendered · deciding next step…",
  },
  "tool-explainSemantics": {
    active: "Reading the semantic layer…",
    done: "Definition ready · deciding next step…",
  },
  "tool-describeData": {
    active: "Reading the data catalog…",
    done: "Catalog ready · deciding next step…",
  },
  "tool-emitVerdict": { active: "Writing the verdict…", done: "Verdict delivered" },
};

function activityLabel(parts: readonly unknown[]): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index] as { type?: unknown; state?: unknown } | null;
    if (typeof part?.type !== "string") continue;
    // Reasoning streams before every tool choice and can run for many seconds.
    // Naming it separates "the model is thinking" from "the stream stalled" —
    // two states that look identical without this label and have twice been
    // misdiagnosed as hangs.
    if (part.type === "reasoning") {
      return part.state === "streaming"
        ? "Model thinking…"
        : "Thinking done · deciding next step…";
    }
    const step = ACTIVITY_STEPS[part.type];
    if (!step) continue;
    return part.state === "output-available" ? step.done : step.active;
  }
  return "Reading the question…";
}

/** emitVerdict is the only terminal step (AGENTS.md invariant 1) — its absence means the run ended without one. */
function hasCompletedVerdict(parts: readonly unknown[]): boolean {
  return parts.some((part) => {
    if (typeof part !== "object" || part === null) return false;
    const candidate = part as { type?: unknown; state?: unknown };
    return candidate.type === "tool-emitVerdict" && candidate.state === "output-available";
  });
}

function messageText(parts: readonly unknown[]): string {
  return parts
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text",
    )
    .map((part) => part.text)
    .join("");
}

/**
 * Thin wrapper: owns which source is bound and renders the picker (V2 §7.4 —
 * one session ↔ one bound source, switching is a new conversation, never
 * mid-chat). All chat/session state lives in ChatSession below.
 */
export function Chat({ sources }: { sources: SourceOption[] }) {
  const [sourceId, setSourceId] = useState(sources[0]?.id);
  const active = sources.find((source) => source.id === sourceId);

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Beyond the Wall of Text</h1>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Chat with your data and get answers as governed figures, not paragraphs — shown here on UK house prices.
        </p>
      </header>

      {sources.length > 1 && (
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {sources.map((source) => (
              <button
                key={source.id}
                type="button"
                onClick={() => setSourceId(source.id)}
                className={
                  source.id === sourceId
                    ? "rounded-full bg-black px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-black"
                    : "rounded-lg border border-black/10 bg-black/[0.02] px-4 py-2 text-sm transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
                }
              >
                {source.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-black/40 dark:text-white/40">
            Switching sources starts a new conversation.
          </p>
        </div>
      )}

      {active === undefined ? (
        <p className="text-sm text-black/50 dark:text-white/50">No data source is registered.</p>
      ) : (
        // The `key` remount IS the new-conversation mechanic: changing it tears
        // down ChatSession's useChat state and mounts a fresh instance with a
        // fresh chatId, so onBoot binds the newly selected source server-side.
        <ChatSession key={active.id} source={active} />
      )}
    </main>
  );
}

function ChatSession({ source }: { source: SourceOption }) {
  const transport = useTriggerChatTransport<typeof houseAgent>({
    task: "house-agent",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) => startChatSession({ chatId, clientData }),
    clientData: { sourceId: source.id },
  });
  const { messages, sendMessage, addToolOutput, stop, status } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });
  const [input, setInput] = useState("");

  const submit = useCallback(
    (text: string) => {
      const question = text.trim();
      if (!question) return;
      sendMessage({ text: question });
      setInput("");
    },
    [sendMessage],
  );

  const isStreaming = status === "streaming" || status === "submitted";
  const empty = messages.length === 0;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const lastAssistantParts = lastAssistant?.parts ?? [];
  // stepCountIs(15) can end the run with no emitVerdict (AGENTS.md invariant 3
  // pitfall) — without this, the process line stays on the last tool's "…
  // deciding next step…" label forever, since only a verdict sets a terminal one.
  const runEndedWithoutVerdict =
    !isStreaming &&
    lastAssistant !== undefined &&
    !hasCompletedVerdict(lastAssistantParts) &&
    pendingClarifications(lastAssistantParts).length === 0;

  return (
    <>
      {empty ? (
        source.exampleQuestions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-black/40 dark:text-white/40">Try asking</p>
            {source.exampleQuestions.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => submit(question)}
                className="rounded-lg border border-black/10 bg-black/[0.02] px-4 py-3 text-left text-sm transition-colors hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"
              >
                {question}
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="flex flex-1 flex-col gap-6">
          {messages.map((message) => {
            if (message.role === "user") {
              return (
                <div key={message.id} className="self-end">
                  <div className="rounded-2xl bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black">
                    {messageText(message.parts)}
                  </div>
                </div>
              );
            }
            const tiles = toolOutputs(message.parts);
            const clarifications = pendingClarifications(message.parts);
            return (
              <div key={message.id} className="flex flex-col gap-4">
                {clarifications.map((clarification) => (
                  <div
                    key={clarification.toolCallId}
                    className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"
                  >
                    <p className="text-sm font-medium">{clarification.question}</p>
                    <p className="mt-0.5 font-mono text-[10px] text-black/40 dark:text-white/40">
                      Governed clarification · run suspended
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {clarification.options.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => addToolOutput({
                            tool: "requestClarification",
                            toolCallId: clarification.toolCallId,
                            output: {
                              field: clarification.field,
                              optionId: option.id,
                              label: option.label,
                            },
                          })}
                          className="rounded-lg border border-black/10 bg-white px-3 py-2 text-left hover:border-amber-500/50 hover:bg-amber-500/10 dark:border-white/15 dark:bg-white/5"
                        >
                          <span className="block text-xs font-medium">
                            {option.label}{option.recommended ? " · recommended" : ""}
                          </span>
                          {option.description && (
                            <span className="block text-[10px] text-black/40 dark:text-white/40">
                              {option.description}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {tiles.map((spec, index) => (
                  <Tile key={index} part={spec} />
                ))}
              </div>
            );
          })}
          {(isStreaming || runEndedWithoutVerdict) && (
            <p
              className={`text-xs text-black/40 dark:text-white/40 ${
                isStreaming ? "animate-pulse" : ""
              }`}
            >
              {isStreaming
                ? activityLabel(lastAssistantParts)
                : "Run ended without a verdict — try narrowing the question."}
            </p>
          )}
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(input);
        }}
        className="sticky bottom-6 mt-8 flex gap-2"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask about the connected data…"
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
    </>
  );
}
