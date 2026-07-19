import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { locals } from "@trigger.dev/sdk";

/**
 * The ClickHouse client, configured once.
 *
 * `keep_alive` is DISABLED deliberately. With it on (the default), idle sockets
 * to ClickHouse Cloud get reset by the server's load balancer and the next query
 * throws `ECONNRESET` — reproduced during the initial data load. This is the
 * documented Node-client failure mode (clickhouse-js-node-troubleshooting).
 * Cloud sits behind a proxy that closes idle keep-alive sockets; turning it off
 * trades a little per-request overhead for reliability, which is the right call
 * for a demo that must not flake on camera.
 *
 * TODO(day5): revisit keep_alive with an idle_socket_ttl instead of disabling,
 * if per-request connection cost shows up in the query-time display.
 */
let client: ClickHouseClient | undefined;

export function clickhouse(): ClickHouseClient {
  if (!client) {
    client = createClient({
      url: required("CLICKHOUSE_URL"),
      username: required("CLICKHOUSE_USER"),
      password: required("CLICKHOUSE_PASSWORD"),
      database: required("CLICKHOUSE_DATABASE"),
      keep_alive: { enabled: false },
      clickhouse_settings: {
        // Surfaced on every tile: rows scanned + elapsed. It's how a judge sees
        // ClickHouse working, so we always want the summary back.
        send_progress_in_http_headers: 1,
      },
    });
  }
  return client;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return v;
}

/**
 * The injectable seam for tools that query ClickHouse.
 *
 * A tool must NOT call `clickhouse()` directly — that hard-wires the real Cloud
 * client and makes the tool untestable without credentials. Instead it reads
 * `getClickHouse()`, which returns whatever the run's `locals` hold. In an
 * offline test, `mockChatAgent`'s `setupLocals` seeds a fake client under this
 * key (testing.mdx "Testing against a database"); in production nothing seeds
 * it, so the first call lazily creates the real one. Same code path, injectable
 * dependency — this is what lets the turn-2 no-leak test run with zero network.
 *
 * `clientData` is NOT the seam for this: that's wire-data from the browser. A DB
 * client is a server-side dependency, so it goes through `locals`.
 */
export const clickhouseKey = locals.create<ClickHouseClient>("clickhouse");

export function getClickHouse(): ClickHouseClient {
  return locals.get(clickhouseKey) ?? locals.set(clickhouseKey, clickhouse());
}
