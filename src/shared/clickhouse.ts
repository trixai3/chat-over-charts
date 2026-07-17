import { createClient, type ClickHouseClient } from "@clickhouse/client";

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
