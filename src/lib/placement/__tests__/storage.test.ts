// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_WORKSPACE,
  readStoredWorkspace,
  UNREADABLE_WORKSPACE_PREFIX,
  WORKSPACE_STORAGE_KEY,
  writeStoredWorkspace,
} from "#/lib/placement/workspace";

beforeEach(() => window.localStorage.clear());

describe("readStoredWorkspace", () => {
  it("reads back what was written", () => {
    writeStoredWorkspace(EMPTY_WORKSPACE);
    expect(readStoredWorkspace()).toEqual({
      status: "ok",
      workspace: EMPTY_WORKSPACE,
    });
  });

  it("reports no workspace when the key is absent", () => {
    expect(readStoredWorkspace()).toEqual({ status: "none" });
  });

  it("copies each unreadable workspace aside, keeping earlier copies", async () => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, '{"version":9}');
    expect(readStoredWorkspace()).toEqual({ status: "unreadable" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, '{"version":8}');
    readStoredWorkspace();
    const copies = Object.keys(window.localStorage)
      .filter((key) => key.startsWith(UNREADABLE_WORKSPACE_PREFIX))
      .map((key) => window.localStorage.getItem(key))
      .sort();
    expect(copies).toEqual(['{"version":8}', '{"version":9}']);
  });
});
