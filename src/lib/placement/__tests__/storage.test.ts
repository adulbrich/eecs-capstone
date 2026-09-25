// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY_WORKSPACE,
  readStoredWorkspace,
  UNREADABLE_WORKSPACE_KEY,
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

  it("copies an unreadable workspace aside before the page can overwrite it", () => {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, '{"version":9}');
    expect(readStoredWorkspace()).toEqual({ status: "unreadable" });
    expect(window.localStorage.getItem(UNREADABLE_WORKSPACE_KEY)).toBe(
      '{"version":9}'
    );
  });
});
