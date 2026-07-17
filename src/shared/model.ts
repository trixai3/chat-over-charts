import { anthropic } from "@ai-sdk/anthropic";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * One switch between a cheap dev model and a strong demo model.
 *
 * The tool loop is only as reliable as the model driving it: the agent has to
 * pick the right tool, fill its params, know when a place is ambiguous, and
 * remember to call emitVerdict. Cheap models are materially worse at that, and
 * a demo is a handful of runs — reliability is worth more than the token cost.
 * So: iterate on DeepSeek, record on a strong model.
 *
 * Only Anthropic gets explicit prompt caching (§5.6). OpenRouter's passthrough
 * is unverified, so don't assume cache hits when MODEL_PROVIDER=openrouter.
 */
export type ModelProvider = "openrouter" | "anthropic";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return v;
}

export function getModelProvider(): ModelProvider {
  const raw = process.env.MODEL_PROVIDER ?? "openrouter";
  if (raw !== "openrouter" && raw !== "anthropic") {
    throw new Error(`MODEL_PROVIDER must be "openrouter" or "anthropic", got "${raw}"`);
  }
  return raw;
}

export function getModel(): LanguageModel {
  const provider = getModelProvider();

  if (provider === "anthropic") {
    required("ANTHROPIC_API_KEY"); // the provider reads it from env itself
    return anthropic(process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5");
  }

  const openrouter = createOpenRouter({ apiKey: required("OPENROUTER_API_KEY") });
  return openrouter(process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat");
}

/** Shown on tiles and in logs so it's never a mystery which model produced a run. */
export function describeModel(): string {
  return getModelProvider() === "anthropic"
    ? `anthropic/${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5"}`
    : `openrouter/${process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat"}`;
}
