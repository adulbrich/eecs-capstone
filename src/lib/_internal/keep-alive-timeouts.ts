import type nodeHttp from "node:http";

/**
 * How long the task holds an idle keep-alive connection open, and why the
 * number is above the load balancer's rather than below it.
 *
 * The ALB keeps a pool of connections to each task and reuses them for up to
 * `idle_timeout`, 60 seconds in `infra/ecs.tf`. Node closes an idle keep-alive
 * connection after `server.keepAliveTimeout`, which defaults to 5 seconds. The
 * shorter side wins, so the ALB routinely dispatches a request onto a
 * connection the task has already closed. Nothing on the ALB side can be
 * retried at that point: the request is gone, the target sends no response,
 * and the ALB answers the student 502 (#545).
 *
 * The load test's four retrieved access log lines are that failure exactly.
 * `target_status_code` was `-`, which AWS records "only if a connection was
 * established to the target and the target sent a response", and
 * `response_processing_time` was `-1`, which AWS documents for "the target
 * closes the connection before the idle timeout". No response was ever sent,
 * so the streaming SSR reading in #545 does not fit: a stream that broke after
 * the shell had flushed would have logged `target_status_code 200` and a
 * truncated body.
 *
 * Why only under saturation, when the mismatch is there at every rate: the
 * ALB opens far more connections to two tasks at 42 requests per second than
 * at 10, and a connection is only dangerous in the window between the task
 * sending its FIN and the ALB noticing. More connections and a loop too busy
 * to answer promptly is more window. Seven failures in 7200 requests is what
 * that looks like.
 *
 * 65 seconds rather than 61 for margin, and because it is the number AWS's own
 * guidance uses. Raising it costs nothing: pg-pool-style idle sockets are a
 * few KB each and the ALB closes its side at 60 seconds regardless, so the
 * task never actually holds one for 65.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;

/**
 * How long a connection may sit between its first byte and a complete set of
 * request headers. Node requires this to exceed `keepAliveTimeout`, and
 * defaults it to 60 seconds, which raising the keep-alive above would leave
 * inverted: Node then applies the shorter headers timeout to an idle
 * keep-alive connection and closes it early, which is the same 502 with a
 * different number on it. One second of margin is all the ordering needs.
 */
export const HEADERS_TIMEOUT_MS = 66_000;

type ServerOptions = Parameters<typeof nodeHttp.createServer>[0];

/**
 * The two timeouts merged into whatever options the server is being created
 * with. Ours win on purpose: this is a fix for a defect, not a default to be
 * overridden, and nothing in the build passes either key today.
 */
export function withKeepAliveTimeouts<T extends ServerOptions>(options: T): T {
  return {
    ...options,
    keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
    headersTimeout: HEADERS_TIMEOUT_MS,
  };
}

/**
 * Applies the timeouts to the HTTP server Nitro is about to create.
 *
 * It has to be done by wrapping `createServer` because there is no seam
 * between the two. Nitro's `node-server` entry calls srvx's `serve()` with a
 * fixed set of options and never passes srvx's `node` key, which is the one
 * that reaches `http.createServer`; srvx's own plugin list is Nitro's, not
 * ours; and the Nitro runtime hooks are `close`, `error`, `request` and
 * `response`, none of which sees the server. Nitro v3 has no configuration
 * for either timeout, which was checked against its docs rather than recalled.
 * The alternative is a project copy of Nitro's entry through the `entry`
 * config option, which forks about forty lines of framework internals,
 * imports virtual modules `tsc --noEmit` cannot resolve, and goes stale
 * silently on the next upgrade. See ADR-0039.
 *
 * The wrapper stays installed rather than restoring itself after the first
 * call. Every HTTP server this process creates should hold the same
 * behaviour, and a self-restoring patch would apply to whichever server was
 * created first, which is an ordering this file cannot see.
 */
export function installKeepAliveTimeouts(http: typeof nodeHttp): void {
  const createServer = http.createServer;
  if (createServer.name === "createServerWithKeepAlive") {
    return;
  }
  function createServerWithKeepAlive(
    this: unknown,
    ...args: Parameters<typeof nodeHttp.createServer>
  ) {
    const [first, second] = args;
    // The overload the caller used decides where the options go: srvx passes
    // `(options, handler)`, but `(handler)` alone is just as legal and has to
    // grow an options object rather than lose its listener.
    return typeof first === "function"
      ? createServer.call(this, withKeepAliveTimeouts({}), first)
      : createServer.call(this, withKeepAliveTimeouts(first ?? {}), second);
  }
  http.createServer = createServerWithKeepAlive as typeof http.createServer;
}
