"use client";

import { useCallback, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { houseAgent } from "../../trigger/house-agent";
import { mintChatAccessToken, startChatSession } from "@/app/actions";
import { Tile } from "@/components/tile-renderer";
import type { DrillTarget } from "@/shared/view-spec";

const EXAMPLES = [
  "How did median prices change per year in London's top districts?",
  "Show Lambeth median prices by year since 2015",
  "Compare property types in Greater London by median price",
];

/** Only presentation tools produce ViewSpecs; planning output stays invisible. */
function toolOutputs(parts: readonly unknown[]): unknown[] {
  return parts
    .filter((part): part is { type: string; state?: string; output?: unknown } => {
      if (typeof part !== "object" || part === null) return false;
      const candidate = part as { type?: unknown; state?: unknown; output?: unknown };
      return (
        (candidate.type === "tool-renderAnalysis" || candidate.type === "tool-emitVerdict") &&
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

export function Chat() {
  const transport = useTriggerChatTransport<typeof houseAgent>({
    task: "house-agent",
    accessToken: ({ chatId }) => mintChatAccessToken(chatId),
    startSession: ({ chatId, clientData }) => startChatSession({ chatId, clientData }),
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

  // Deliberate placeholder: drill behavior is outside this redesign.
  const onDrill = (target: DrillTarget) => console.log("drill placeholder:", target);
  const isStreaming = status === "streaming" || status === "submitted";
  const empty = messages.length === 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Beyond the Wall of Text</h1>
        <p className="mt-1 text-sm text-black/50 dark:text-white/50">
          Ask an analytical question. The answer is a governed figure, never a paragraph.
        </p>
      </header>

      {empty ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-black/40 dark:text-white/40">Try asking</p>
          {EXAMPLES.map((question) => (
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
                  <Tile key={index} part={spec} onDrill={onDrill} onResolve={onDrill} />
                ))}
              </div>
            );
          })}
          {isStreaming && (
            <p className="animate-pulse text-xs text-black/40 dark:text-white/40">
              Resolving semantics · planning query · validating figure…
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
    </main>
  );
}
