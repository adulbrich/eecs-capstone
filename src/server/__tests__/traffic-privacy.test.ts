import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { trafficEvents, trafficVisits } from "#/db/schema";

/**
 * The privacy page's claims about the traffic writer that source can prove:
 * it is never connected to an account, and it does not store an address.
 * The runtime claims (no cookie set, no address in a row, no storage touched)
 * are in `traffic-writer.test.ts`, `traffic.integration.test.ts` and
 * `src/test/use-traffic.test.tsx`.
 */

const SRC = join(process.cwd(), "src");
const ENTRY = join(SRC, "routes/api/traffic.ts");
/** `import` and `export ... from`, so a re-export like `schema.ts`'s is walked. */
const IMPORT =
  /^\s*(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gm;

function resolveLocal(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("#/")) {
    base = join(SRC, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(from), specifier);
  } else {
    return null;
  }
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) {
      return candidate;
    }
  }
  throw new Error(`cannot resolve ${specifier} from ${from}`);
}

/** Every file the route reaches through local imports, and every package it names. */
function importGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Map<string, string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) {
      continue;
    }
    files.add(file);
    for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT)) {
      const local = resolveLocal(file, specifier);
      if (local) {
        queue.push(local);
      } else {
        packages.set(specifier, relative(SRC, file));
      }
    }
  }
  return {
    files: [...files].map((f) => relative(SRC, f)),
    packages,
  };
}

describe("the traffic writer's import graph", () => {
  const graph = importGraph(ENTRY);

  it("reaches the writer, so the walk is reading the right files", () => {
    expect(graph.files).toContain("server/_internal/traffic-writer.ts");
    expect(graph.files).toContain("lib/_internal/traffic-request.ts");
    expect(graph.packages.has("isbot")).toBe(true);
  });

  it("never reaches Better Auth or the app's auth modules", () => {
    const betterAuth = [...graph.packages.keys()].filter(
      (p) => p === "better-auth" || p.startsWith("better-auth/")
    );
    expect(betterAuth).toEqual([]);
    expect(graph.files.filter((f) => f.startsWith("lib/auth"))).toEqual([]);
  });

  it("takes only the IP walk from Better Auth's core package", () => {
    // `@better-auth/core/utils/ip` is the walk Better Auth runs for
    // `session.ipAddress`, and holds no session or account code. Anything
    // else from the core package would need the same argument made again.
    const core = [...graph.packages.keys()].filter((p) =>
      p.startsWith("@better-auth/")
    );
    expect(core).toEqual(["@better-auth/core/utils/ip"]);
  });

  it("writes through its own pool, never the app's", () => {
    expect(graph.files).toContain("db/traffic.ts");
    expect(graph.files).not.toContain("db/index.ts");
  });
});

describe("the traffic_events table", () => {
  it("has exactly the columns #591 specifies, plus #592's day, none of them a person or an address", () => {
    const columns = Object.values(getTableColumns(trafficEvents)).map(
      (c) => c.name
    );
    expect(columns.sort()).toEqual(
      [
        "browser",
        "country",
        "day",
        "device",
        "id",
        "kind",
        "occurred_at",
        "os",
        "pathname",
        "previous_path",
        "referrer_host",
        "search",
        "visitor_hash",
      ].sort()
    );
    for (const name of columns) {
      expect(name).not.toMatch(/user|email|^ip$|_ip|address|agent|session/);
    }
  });
});

describe("the traffic_visits rollup", () => {
  it("holds no visitor hash, no address and nothing about a person", () => {
    // A rollup row is a visit with its identity removed: nothing in it can
    // join one visit to another, to an event, or to an account (ADR-0050).
    const columns = Object.values(getTableColumns(trafficVisits)).map(
      (c) => c.name
    );
    for (const name of columns) {
      expect(name).not.toMatch(
        /hash|visitor|user|email|^ip$|_ip|address|agent|session/
      );
    }
  });
});
