import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refreshProjectInBackground,
  settleProjectRefreshes,
} from "#/server/_internal/project-refresh";

const calls: string[] = [];
let releaseFirst: () => void = () => undefined;

vi.mock("#/server/_internal/project-embeddings", () => ({
  refreshProjectEmbedding: async (id: string) => {
    calls.push(`embed ${id}`);
    return "updated";
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
    return "failed";
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
});
