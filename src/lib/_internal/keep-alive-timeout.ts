import type nodeHttp from "node:http";

/**
 * How long the task holds an idle keep-alive connection open, and why the
 * number is above the load balancer's rather than below it.
 *
 * The ALB keeps a pool of connections to each task and reuses them for up to
 * `idle_timeout`, 60 seconds in `infra/ecs.tf`. Node closes an idle keep-alive
 * connection after `server.keepAliveTimeout`, which defaults to 5 seconds. The
 * shorter side wins, so the ALB routinely dispatches a request onto a
 * connection the task has already closed. Nothing can be retried at that
 * point: the request is gone, the target sends no response, and the ALB
 * answers the student 502 (#545).
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
 * Measured rather than assumed, on the `.nvmrc` Node: the FIN goes out at
 * `keepAliveTimeout` plus a consistent extra second, so production's effective
 * idle life was about 6 seconds against the balancer's 60, and the grace is
 * neither `headersTimeout` nor `connectionsCheckingInterval`, both of which
 * were varied without moving it. Do not lean on that second. It is an
 * observation about one Node version, not a contract, and the margin below is
 * what the fix actually rests on.
 *
 * 65 seconds rather than 61 for that margin, and because it is the number
 * AWS's own guidance uses. Raising it costs nothing: the ALB still closes its
 * side at 60 seconds, so the task never holds an idle connection for 65, and
 * an idle socket is a few KB against a 1024 MB task.
 *
 * `headersTimeout` is deliberately left at Node's default. The obvious worry
 * is that 60 seconds, being below this, would close an idle connection first
 * and reintroduce the same 502 under a different timer. It does not: a server
 * at `keepAliveTimeout` 8000 and `headersTimeout` 3000 sent its FIN at 9006
 * ms, not at 4000, and one at 65000 against 60000 was still open at 14 s.
 * Since Node 18.14 `headersTimeout` bounds a request whose headers have begun
 * arriving, not a connection sitting idle, and Node 24's documentation states
 * no ordering requirement between the two. Raising it would only weaken a
 * slow-headers bound for no measured gain.
 */
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;

type ServerOptions = Parameters<typeof nodeHttp.createServer>[0];

/**
 * The timeout merged into whatever options the server is being created with.
 * Ours wins on purpose: this is a fix for a defect, not a default to be
 * overridden, and nothing in the build passes the key today. The return type
 * says the key is there rather than echoing the argument's, so a caller that
 * reads it back is not relying on the implementation.
 */
export function withKeepAliveTimeout<T extends ServerOptions>(
  options: T
): T & { keepAliveTimeout: number } {
  return { ...options, keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS };
}

/**
 * Marks the wrapper as ours, so installing twice is a no-op. A symbol rather
 * than a check on `createServer.name`: the bundler is free to rename a
 * function it has to deconflict, and a name comparison would then fail open
 * silently, leaving a wrapper around a wrapper and a test that no longer
 * tests what it says.
 */
const INSTALLED = Symbol.for("eecs-capstone.keepAliveTimeout.installed");

/**
 * Applies the timeout to the HTTP server Nitro is about to create.
 *
 * It has to be done by wrapping `createServer` because there is no seam
 * between the two. Nitro's `node-server` entry calls srvx's `serve()` with a
 * fixed set of options and never passes srvx's `node` key, which is the one
 * that reaches `http.createServer`; srvx's own plugin list is Nitro's, not
 * ours; and the Nitro runtime hooks are `close`, `error`, `request` and
 * `response`, none of which sees the server. Nitro v3 has no configuration
 * for the timeout, which was checked against its docs rather than recalled.
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
export function installKeepAliveTimeout(http: typeof nodeHttp): void {
  const createServer = http.createServer;
  if (INSTALLED in createServer) {
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
      ? createServer.call(this, withKeepAliveTimeout({}), first)
      : createServer.call(this, withKeepAliveTimeout(first ?? {}), second);
  }
  Object.defineProperty(createServerWithKeepAlive, INSTALLED, { value: true });
  http.createServer = createServerWithKeepAlive as typeof http.createServer;
}
