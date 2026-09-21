import { readFileSync } from "node:fs";
import http from "node:http";
import { describe, expect, it } from "vitest";
import {
  installKeepAliveTimeout,
  KEEP_ALIVE_TIMEOUT_MS,
  withKeepAliveTimeout,
} from "../_internal/keep-alive-timeout";

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
    installKeepAliveTimeout(http);
    return create(http);
  } finally {
    http.createServer = original;
  }
}

describe("the keep-alive timeout", () => {
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

  it("beats Node's own default, which is what production ran", () => {
    // Node 24 defaults this to 5000, read off a bare server rather than
    // written down, so a future Node that fixes it upstream makes the
    // assertion trivially true instead of wrong.
    const bare = http.createServer();
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(bare.keepAliveTimeout);
    bare.close();
  });
});

describe("withKeepAliveTimeout", () => {
  it("leaves the caller's other options alone", () => {
    const merged = withKeepAliveTimeout({ maxHeaderSize: 4096 });
    expect(merged.maxHeaderSize).toBe(4096);
  });

  it("leaves headersTimeout to Node", () => {
    // Measured, not assumed: `headersTimeout` bounds a request whose headers
    // have begun arriving, not an idle connection, so it plays no part in this
    // fix. A server at keepAliveTimeout 8000 and headersTimeout 3000 sent its
    // FIN at 9006 ms. Setting it here would only weaken a slow-headers bound.
    expect(withKeepAliveTimeout({})).not.toHaveProperty("headersTimeout");
  });

  it("is authoritative over a value already in the options", () => {
    // A fix for a defect, not a default: the point is that nothing quietly
    // puts production back on a timeout below the load balancer's.
    const merged = withKeepAliveTimeout({ keepAliveTimeout: 5000 });
    expect(merged.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
  });
});

describe("installKeepAliveTimeout", () => {
  it("applies the timeout to a server created with options and a handler", () => {
    // The overload srvx uses: `createServer(options, handler)`, from
    // node_modules/srvx/dist/adapters/node.mjs.
    const handler = () => {
      // never called
    };
    const server = serverThroughWrapper((module) =>
      module.createServer({ maxHeaderSize: 4096 }, handler)
    );

    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
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
      installKeepAliveTimeout(http);
      const once = http.createServer;
      installKeepAliveTimeout(http);
      expect(http.createServer).toBe(once);
    } finally {
      http.createServer = original;
    }
  });
});
