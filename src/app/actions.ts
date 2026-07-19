"use server";

import { auth } from "@trigger.dev/sdk";
import { chat } from "@trigger.dev/sdk/ai";

/**
 * The two server actions the transport calls. These are Next.js **server
 * actions** (`"use server"`), NOT API routes — a different primitive, and the
 * one the SDK is designed around. AGENTS.md invariant 7 ("no API routes") holds:
 * there is no route handler here, and the browser never sees the secret key.
 * Both run server-side, where our authorization would live if we had users.
 */

// Creates the durable Session row + triggers the first run, returns the
// session-scoped PAT. Idempotent on (env, chatId), so concurrent first-message
// calls converge to one session instead of racing two runs.
export const startChatSession = chat.createStartSessionAction("house-agent");

// Pure mint: a fresh session-scoped token for an existing session. The transport
// calls this on a 401/403 to refresh — read+write scoped to just this chatId, so
// a leaked token can't touch any other conversation.
export async function mintChatAccessToken(chatId: string) {
  return auth.createPublicToken({
    scopes: {
      read: { sessions: chatId },
      write: { sessions: chatId },
    },
    expirationTime: "1h",
  });
}
