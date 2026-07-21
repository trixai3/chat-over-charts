import { locals } from "@trigger.dev/sdk";
import { getSemanticModel, listSemanticModels } from "../analysis/semantic-model";

// The source a chat session analyzes. The server/UI binds it at session start;
// the model has no channel to choose or change it. Read by every tool that
// needs a sourceId. Mirrors clickhouseKey: a run-local, seeded in onBoot (prod)
// or setupLocals (tests), with a lazy single-source fallback.
export const boundSourceKey = locals.create<string>("boundSource");

export function bindSource(sourceId: string): string {
  if (!getSemanticModel(sourceId)) throw new Error(`Unknown or unauthorized source: ${sourceId}`);
  return locals.set(boundSourceKey, sourceId);
}

export function getBoundSourceId(): string {
  const bound = locals.get(boundSourceKey);
  if (bound) return bound;
  // No explicit binding: a single-source deployment resolves to its one source.
  // With several registered, binding is mandatory — no silent default, so the
  // wrong source can never be assumed.
  const sources = listSemanticModels();
  if (sources.length === 1) return sources[0].id;
  throw new Error("No source bound for this session and multiple sources are registered.");
}
