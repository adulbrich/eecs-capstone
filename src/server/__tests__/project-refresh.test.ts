import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refreshProjectInBackground,
  settleProjectRefreshes,
} from "#/server/_internal/project-refresh";

const calls: string[] = [];
let releaseFirst: () => void = () => undefined;
/** Per project id, the outcomes the two mocked writers report. */
const outcomes = new Map<string, { embedding: string; summary: string }>();

vi.mock("#/server/_internal/project-embeddings", () => ({
  refreshProjectEmbedding: async (id: string) => {
    if (id === "throws") {
      throw new Error("escaped the refresh's own catch");
    }
    calls.push(`embed ${id}`);
    return outcomes.get(id)?.embedding ?? "updated";
  },
}));

vi.mock("#/server/_internal/project-social-summary", () => ({
  refreshSocialSummary: async (id: string) => {
    calls.push(`summary ${id} start`);
    if (calls.filter((c) => c === `summary ${id} start`).length === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
    calls.push(`summary ${id} end`);
    return outcomes.get(id)?.summary ?? "failed";
  },
}));

afterEach(async () => {
  releaseFirst();
  await settleProjectRefreshes();
  calls.length = 0;
  vi.restoreAllMocks();
});

describe("refreshProjectInBackground", () => {
  it("returns before the refresh finishes, and logs both outcomes when it does", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    refreshProjectInBackground("p1");
    await vi.waitFor(() => expect(calls).toContain("summary p1 start"));
    expect(log).not.toHaveBeenCalled();

    releaseFirst();
    await settleProjectRefreshes();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(
      /^Project refresh for p1: embedding updated, social summary failed, \d+ ms$/
    );
  });

  it("runs a project's second refresh only after its first, so the last commit's text wins", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    refreshProjectInBackground("p2");
    refreshProjectInBackground("p2");
    await vi.waitFor(() => expect(calls).toContain("summary p2 start"));
    expect(calls).toEqual(["embed p2", "summary p2 start"]);

    releaseFirst();
    await settleProjectRefreshes();
    expect(calls).toEqual([
      "embed p2",
      "summary p2 start",
      "summary p2 end",
      "embed p2",
      "summary p2 start",
      "summary p2 end",
    ]);
  });

  it("logs a rejection that escapes both refreshes instead of leaving it unhandled", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    refreshProjectInBackground("throws");
    await settleProjectRefreshes();

    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Project refresh failed for throws",
      expect.stringContaining("escaped the refresh's own catch")
    );
  });
});

const FILTER_OPENER =
  'resource "aws_cloudwatch_log_metric_filter" "ai_write_failures" {';
const OR_PHRASE = /\?"([^"]+)"/g;

/** The `pattern` on the metric filter in `infra/alarms.tf`, unescaped. */
function filterPattern(): string {
  const block =
    readFileSync("infra/alarms.tf", "utf8")
      .split(FILTER_OPENER)[1]
      ?.split("\n}")[0] ?? "";
  const line = block
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("pattern "));
  // An HCL string with only `\"` escapes is also a JSON string.
  return JSON.parse(line?.slice(line.indexOf("=") + 1).trim() ?? '""');
}

/**
 * CloudWatch's unstructured match for a pattern made only of `?"phrase"`
 * terms: an event matches when it contains any one phrase, case sensitive.
 * The first test below holds the pattern to that shape, since it is all this
 * imitates.
 */
function filterMatches(line: string): boolean {
  const phrases = [...filterPattern().matchAll(OR_PHRASE)].map(
    (match) => match[1]
  );
  return phrases.some((phrase) => line.includes(phrase));
}

/** The line a real refresh logs for one pair of outcomes. */
async function refreshLine(
  id: string,
  embedding: string,
  summary: string
): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  outcomes.set(id, { embedding, summary });
  refreshProjectInBackground(id);
  await vi.waitFor(() => expect(calls).toContain(`summary ${id} start`));
  releaseFirst();
  await settleProjectRefreshes();
  outcomes.delete(id);
  return String(log.mock.calls.at(-1)?.[0]);
}

describe("the ai_write_failures metric filter in infra/alarms.tf", () => {
  it("is only OR'd quoted phrases, the shape filterMatches imitates", () => {
    const pattern = filterPattern();
    expect(pattern.match(OR_PHRASE)?.length).toBeGreaterThan(0);
    expect(pattern.replace(OR_PHRASE, "").trim()).toBe("");
  });

  it.each([
    ["failed", "updated", true],
    ["updated", "failed", true],
    ["failed", "failed", true],
    ["updated", "updated", false],
    ["unchanged", "skipped", false],
    ["superseded", "unchanged", false],
  ])(
    "counts a refresh line with embedding %s and social summary %s: %s",
    async (embedding, summary, counted) => {
      const line = await refreshLine("counted", embedding, summary);
      expect(line).toMatch(/^Project refresh for counted: /);
      expect(filterMatches(line)).toBe(counted);
    }
  );

  it("counts a failed interest embedding once and a project's own error lines not at all", () => {
    // The interest line is the only record of that writer. The two project
    // lines report the failure the refresh line already counted.
    expect(
      filterMatches("Embedding failed for user interests u1 Error: throttled")
    ).toBe(true);
    expect(filterMatches("Embedding failed for project p1 Error: x")).toBe(
      false
    );
    expect(
      filterMatches("Social summary failed for project p1: truncated")
    ).toBe(false);
  });
});
