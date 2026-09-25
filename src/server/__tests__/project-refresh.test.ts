import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactingAuthLogger } from "#/lib/_internal/redact-query-error";
import type { RefreshOutcome } from "#/server/_internal/project-embeddings";
import {
  refreshProjectInBackground,
  settleProjectRefreshes,
} from "#/server/_internal/project-refresh";
import type { SocialSummaryOutcome } from "#/server/_internal/project-social-summary";

const calls: string[] = [];
let releaseFirst: () => void = () => undefined;
/** Per project id, the outcomes the two mocked writers report. */
const outcomes = new Map<
  string,
  { embedding: RefreshOutcome; summary: SocialSummaryOutcome }
>();

/**
 * What every `db.select().from().where()` resolves to, so the real writers
 * below can be driven to their failure lines without a database.
 */
const selectRows = vi.hoisted(() => vi.fn<() => Promise<unknown[]>>());

vi.mock("#/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => selectRows() }) }) },
}));

// The rest of the module stays real: `refreshSocialSummary` imports
// `isEmbeddableStatus` and `rowStillReads` from it.
vi.mock("#/server/_internal/project-embeddings", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#/server/_internal/project-embeddings")
  >()),
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
  selectRows.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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

/** The `pattern` on the metric filter in `infra/alarms.tf`, unescaped. */
function filterPattern(): string {
  const block =
    readFileSync("infra/alarms.tf", "utf8")
      .split(FILTER_OPENER)[1]
      ?.split("\n}")[0] ?? "";
  const line = block
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("pattern "));
  // An HCL string with only `\\` escapes is also a JSON string.
  return JSON.parse(line?.slice(line.indexOf("=") + 1).trim() ?? '""');
}

/**
 * A `%regex%` pattern in the subset CloudWatch documents that JavaScript
 * reads the same way: letters, digits, space, its nine symbols, and its
 * operators other than parentheses, which it does not support. Every `|`
 * alternative starts with `^`, since a phrase matched anywhere in a line can
 * be text a stranger sent.
 */
const ANCHORED_REGEX = /^%\^[\w :#=@/;,\-^$?[\]{}|\\*+.]+%$/;

/**
 * CloudWatch's match for a standalone `%regex%` pattern: the event matches
 * when the expression finds a match in it, case sensitive. The first test
 * below holds the pattern to `ANCHORED_REGEX`, since that is all this
 * imitates.
 */
function filterMatches(line: string): boolean {
  return new RegExp(filterPattern().slice(1, -1)).test(line);
}

/** The line a real refresh logs for one pair of outcomes. */
async function refreshLine(
  id: string,
  embedding: RefreshOutcome,
  summary: SocialSummaryOutcome
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

/** The real writers, past the mocks this file puts in front of them. */
const realEmbeddings = () =>
  vi.importActual<typeof import("#/server/_internal/project-embeddings")>(
    "#/server/_internal/project-embeddings"
  );
const realSocialSummary = () =>
  vi.importActual<typeof import("#/server/_internal/project-social-summary")>(
    "#/server/_internal/project-social-summary"
  );

// A model call Bedrock refuses, for either writer.
const refusedModelCall = () => Promise.reject(new Error("throttled"));

const INTEREST_ROW = {
  userId: "u1",
  interestsText: "robotics",
  embedding: null,
  embeddingSourceHash: null,
};

/** A live project with no vector and no summary, so both writers call out. */
const PROJECT_ROW = {
  id: "p1",
  status: "published",
  deletedAt: null,
  title: "A rover",
  description: "Drives on sand.",
  problemStatement: null,
  objectives: null,
  minQualifications: null,
  prefQualifications: null,
  licenseRestrictions: null,
  embedding: null,
  embeddingSourceHash: null,
  socialSummary: null,
  socialSummarySourceHash: null,
  socialSummaryIsManual: false,
};

describe("the ai_write_failures metric filter in infra/alarms.tf", () => {
  it("is an anchored regex in the subset filterMatches imitates", () => {
    const pattern = filterPattern();
    expect(pattern).toMatch(ANCHORED_REGEX);
    for (const alternative of pattern.slice(1, -1).split("|")) {
      expect(alternative).toMatch(/^\^/);
    }
  });

  it.each([
    "Invalid callbackURL: https://x.invalid/embedding failed, social summary",
    "Invalid origin: social summary failed",
    "Invalid callbackURL: Embedding failed for user interests u1",
    "Invalid callbackURL: x\nProject refresh for p1: embedding failed, social summary failed, 1 ms",
    "Invalid callbackURL: x\r\nEmbedding failed for user interests u1",
  ])(
    "does not count a Better Auth line carrying a stranger's text: %j",
    (message) => {
      // Better Auth logs a rejected callbackURL or Origin word for word
      // (better-auth/dist/api/middlewares/origin-check.mjs). awslogs makes each
      // line of a write its own event, so a newline would start one.
      const written: string[] = [];
      redactingAuthLogger((line) => written.push(line))("error", message);

      const events = written.join("\n").split("\n");
      expect(events).toHaveLength(1);
      expect(events.filter(filterMatches)).toEqual([]);
    }
  );

  it.each<[RefreshOutcome, SocialSummaryOutcome, boolean]>([
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

  it.each([
    {
      writer: "refreshInterestsEmbedding",
      counted: true,
      printed: /^Embedding failed for user interests u1$/,
      fail: async () => {
        selectRows.mockResolvedValue([INTEREST_ROW]);
        const { refreshInterestsEmbedding } = await realEmbeddings();
        return refreshInterestsEmbedding("u1", refusedModelCall);
      },
    },
    {
      writer: "refreshProjectEmbedding",
      counted: false,
      printed: /^Embedding failed for project p1$/,
      fail: async () => {
        selectRows.mockResolvedValue([PROJECT_ROW]);
        const { refreshProjectEmbedding } = await realEmbeddings();
        return refreshProjectEmbedding("p1", refusedModelCall);
      },
    },
    {
      writer: "refreshSocialSummary, the model call failing,",
      counted: false,
      printed: /^Social summary failed for project p1: /,
      fail: async () => {
        selectRows.mockResolvedValue([PROJECT_ROW]);
        const { refreshSocialSummary } = await realSocialSummary();
        return refreshSocialSummary("p1", refusedModelCall);
      },
    },
    {
      writer: "refreshSocialSummary, the read throwing,",
      counted: false,
      printed: /^Social summary failed for project p1$/,
      fail: async () => {
        selectRows.mockRejectedValue(new Error("connection refused"));
        const { refreshSocialSummary } = await realSocialSummary();
        return refreshSocialSummary("p1");
      },
    },
  ])(
    "$writer prints an error line the filter counts: $counted",
    async ({ counted, printed, fail }) => {
      // The interest line is the only record of that writer. The project
      // lines report a failure the refresh line already counted, so matching
      // them would count it twice. The flag is stubbed on because the unit
      // suite reads your dotenv files, where it may be off.
      vi.stubEnv("BEDROCK_SOCIAL_SUMMARY_ENABLED", "true");
      const error = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      expect(await fail()).toBe("failed");
      const line = String(error.mock.calls[0]?.[0]);
      expect(line).toMatch(printed);
      expect(filterMatches(line)).toBe(counted);
    }
  );
});
