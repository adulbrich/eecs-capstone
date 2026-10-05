// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import Papa from "papaparse";
import { afterEach, describe, expect, it } from "vitest";
import { usePlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { PLUGIN_FIXTURES } from "#/lib/placement/__tests__/plugin-fixtures";
import { qualtricsBids } from "#/lib/placement/plugins/qualtrics";
import type { WorkspaceProject } from "#/lib/placement/types";
import {
  EMPTY_WORKSPACE,
  type Workspace,
  writeStoredWorkspace,
} from "#/lib/placement/workspace";

// Invented names and example.edu addresses only (#648).

afterEach(() => {
  localStorage.clear();
});

const project = (title: string): WorkspaceProject => ({
  key: title.toLowerCase(),
  title,
  weightMultiplier: 1,
});

/** A Qualtrics export whose one student says they were pre-assigned. */
const PRE_ASSIGNED = Papa.unparse([
  ["Q0", "Q1", "Q2", "Q3", "Q4"],
  [
    "Recipient Email",
    "Have you been pre-assigned a project?",
    "What is the name of your project?",
    "Rank your top choices. - Tide Clock",
    "Rank your top choices. - Robot Arm",
  ],
  ["recipientEmail", "QID43", "QID44_TEXT", "QID30_1", "QID30_2"].map((id) =>
    JSON.stringify({ ImportId: id })
  ),
  ["ada@example.edu", "Yes", "Lantern Map", "1", "2"],
]);

async function loaded(workspace: Workspace) {
  writeStoredWorkspace(workspace);
  const hook = renderHook(() => usePlacementWorkspace());
  await waitFor(() => expect(hook.result.current.workspace).not.toBeNull());
  return hook;
}

describe("a file converted on read (#733)", () => {
  it("pins a pre-assigned student once their project is added after the upload", async () => {
    const { result } = await loaded({
      ...EMPTY_WORKSPACE,
      projects: [project("Tide Clock"), project("Robot Arm")],
      bids: { filename: "survey.csv", text: PRE_ASSIGNED },
    });
    expect(result.current.bidsSource?.plugin).toBe(qualtricsBids);
    expect(result.current.bids?.students[0].pin).toBeUndefined();

    act(() =>
      result.current.update((w) => ({
        ...w,
        projects: [...w.projects, project("Lantern Map")],
      }))
    );
    expect(result.current.bids?.students[0].pin).toBe("lantern map");
  });

  it("reads a workspace saved with the converted text to the same students", async () => {
    const projects = [project("Tide Clock"), project("Robot Arm")];
    const converted = qualtricsBids.toStandard(PRE_ASSIGNED, { projects });
    const legacy = await loaded({
      ...EMPTY_WORKSPACE,
      projects,
      bids: {
        filename: "survey (converted).csv",
        text: converted.text,
        convertedFrom: "survey.csv",
        conversionIssues: converted.issues,
      },
    });
    const legacyStudents = legacy.result.current.bids?.students;
    expect(legacy.result.current.bidsSource?.plugin).toBeNull();
    legacy.unmount();
    localStorage.clear();
    // The same export uploaded by this build: stored raw, converted on read.
    const fresh = await loaded({
      ...EMPTY_WORKSPACE,
      projects,
      bids: { filename: "survey.csv", text: PRE_ASSIGNED },
    });
    expect(legacyStudents?.[0].bids).toHaveLength(2);
    expect(fresh.result.current.bids?.students).toEqual(legacyStudents);
  });

  it("reads a saved Canvas roster, which has no plugin id, as Canvas", async () => {
    const { result } = await loaded({
      ...EMPTY_WORKSPACE,
      roster: {
        source: { kind: "csv", filename: "canvas.csv" },
        text: PLUGIN_FIXTURES["canvas-roster"],
      },
    });
    expect(result.current.roster?.plugin?.id).toBe("canvas-roster");
    expect(result.current.roster?.entries.map((e) => e.email)).toEqual([
      "ada@example.edu",
      "kim@example.edu",
    ]);
  });

  it("reads the file as the standard format when staff choose it", async () => {
    const { result } = await loaded({
      ...EMPTY_WORKSPACE,
      roster: {
        source: { kind: "csv", filename: "canvas.csv" },
        text: PLUGIN_FIXTURES["canvas-roster"],
      },
    });
    act(() =>
      result.current.update((w) => ({
        ...w,
        roster: w.roster && { ...w.roster, readAs: null },
      }))
    );
    expect(result.current.roster?.plugin).toBeNull();
    expect(result.current.roster?.issues).toEqual([
      expect.objectContaining({ message: 'The file has no "email" column.' }),
    ]);
  });
});

describe("a bids file read wide through a column mapping (#736)", () => {
  it("names whose bid a converted row is, so it is not mistaken for the file's row", async () => {
    const { result } = await loaded({
      ...EMPTY_WORKSPACE,
      projects: [project("Tide Clock"), project("Robot Arm")],
      bids: {
        filename: "form.csv",
        text: [
          "Mail,Pick [Tide Clock],Pick [Robot Arm]",
          "ada@example.edu,1,first",
          "kim@example.edu,,",
        ].join("\n"),
        readAs: "custom-mapping-bids",
        mapping: {
          version: 2,
          dataset: "bids",
          columns: { Mail: "email" },
          wide: {
            projectColumns: { by: "prefix", prefix: "Pick" },
            title: { by: "brackets" },
          },
        },
      },
    });
    // Row 3 of the file is Kim's; row 3 of the converted file is Ada's.
    expect(result.current.bidsSource?.issues).toEqual([
      expect.objectContaining({ level: "warning", row: 3 }),
    ]);
    expect(result.current.bids?.issues).toEqual([
      expect.objectContaining({
        row: 3,
        message: expect.stringContaining(
          "That row is ada@example.edu's bid for Robot Arm."
        ),
      }),
    ]);
  });
});
