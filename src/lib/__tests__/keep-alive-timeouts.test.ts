import { readFileSync } from "node:fs";
import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  HEADERS_TIMEOUT_MS,
  installKeepAliveTimeouts,
  KEEP_ALIVE_TIMEOUT_MS,
  withKeepAliveTimeouts,
} from "../_internal/keep-alive-timeouts";

/** The `idle_timeout` on the `aws_lb` block in `infra/ecs.tf`, in seconds. */
function albIdleTimeoutMs(): number {
  const source = readFileSync("infra/ecs.tf", "utf8");
  const block = source.split('resource "aws_lb" "app" {')[1]?.split("\n}")[0];
  const seconds = /^\s*idle_timeout\s*=\s*(\d+)/m.exec(block ?? "")?.[1];
  return Number(seconds) * 1000;
}

/**
 * A server built through the wrapper, with the wrapper restored afterwards so
 * one test cannot decide another's starting state.
 */
function serverThroughWrapper(
  create: (module: typeof http) => http.Server
): http.Server {
  const original = http.createServer;
  try {
    installKeepAliveTimeouts(http);
    return create(http);
  } finally {
    http.createServer = original;
  }
}

describe("the keep-alive timeouts", () => {
  it("outlasts the load balancer's idle timeout", () => {
    // The whole defect in one inequality (#545). The ALB reuses a pooled
    // connection for `idle_timeout`; whichever side closes first decides, and
    // when it is the task the ALB dispatches onto a connection that is already
    // gone and answers 502. This reads the Terraform rather than restating the
    // number, so raising one side without the other fails here.
    const albIdle = albIdleTimeoutMs();
    expect(albIdle).toBeGreaterThan(0);
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(albIdle);
  });

  it("keeps the headers timeout above the keep-alive timeout", () => {
    // Node applies the shorter of the two to an idle keep-alive connection, so
    // an inverted pair closes it early and reintroduces the same 502 under a
    // different timer. Node's default headers timeout is 60 s, which the
    // keep-alive above now exceeds, which is why this has to be set too.
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
  });

  it("beats Node's own defaults, which are what production ran", () => {
    // Node 24 defaults keepAliveTimeout to 5000 and headersTimeout to 60000,
    // read off a bare server rather than written down, so a future Node that
    // fixes this upstream makes the assertion trivially true instead of wrong.
    const bare = http.createServer();
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(bare.keepAliveTimeout);
    bare.close();
  });
});

describe("withKeepAliveTimeouts", () => {
  it("leaves the caller's other options alone", () => {
    const merged = withKeepAliveTimeouts({ maxHeaderSize: 4096 });
    expect(merged.maxHeaderSize).toBe(4096);
  });

  it("is authoritative over a value already in the options", () => {
    // A fix for a defect, not a default: the point is that nothing quietly
    // puts production back on a timeout below the load balancer's.
    const merged = withKeepAliveTimeouts({ keepAliveTimeout: 5000 });
    expect(merged.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
  });
});

describe("installKeepAliveTimeouts", () => {
  it("applies the timeouts to a server created with options and a handler", () => {
    // The overload srvx uses: `createServer(options, handler)`, from
    // node_modules/srvx/dist/adapters/node.mjs.
    const handler = () => {
      // never called
    };
    const server = serverThroughWrapper((module) =>
      module.createServer({ maxHeaderSize: 4096 }, handler)
    );

    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(server.listenerCount("request")).toBe(1);
    server.close();
  });

  it("keeps the listener when the handler is the only argument", () => {
    // `createServer(handler)` is just as legal, and growing an options object
    // must not cost the caller its listener.
    const handler = () => {
      // never called
    };
    const server = serverThroughWrapper((module) =>
      module.createServer(handler)
    );

    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.listenerCount("request")).toBe(1);
    server.close();
  });

  it("does not stack when it runs twice", () => {
    // Nitro runs plugins once, but a wrapper that wrapped itself would grow a
    // call per boot path and be invisible until it was not.
    const original = http.createServer;
    try {
      installKeepAliveTimeouts(http);
      const once = http.createServer;
      installKeepAliveTimeouts(http);
      expect(http.createServer).toBe(once);
    } finally {
      http.createServer = original;
    }
  });
});
