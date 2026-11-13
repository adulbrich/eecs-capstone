// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CategorizeBackfillDialog } from "#/components/categorize-backfill-dialog";
import { deferred } from "./shared/deferred";

const server = vi.hoisted(() => ({
  categorizeNextProject: vi.fn(),
  countUncategorizedProjects: vi.fn(),
}));
vi.mock("#/server/categories", () => server);
const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate }),
}));

const IDS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];

beforeEach(() => {
  server.categorizeNextProject.mockReset();
  server.countUncategorizedProjects.mockReset();
  invalidate.mockReset();
  server.countUncategorizedProjects.mockResolvedValue({ count: 3 });
});

afterEach(() => {
  cleanup();
});

async function openDialog() {
  render(<CategorizeBackfillDialog />);
  fireEvent.click(
    screen.getByRole("button", { name: "Categorize uncategorized" })
  );
  expect(
    await screen.findByText("3 projects have no categories.")
  ).toBeTruthy();
}

function step(i: number, outcome: string) {
  return {
    done: false,
    outcome,
    projectId: IDS[i],
    title: `Project ${i + 1}`,
  };
}

describe("the categorization backfill dialog", () => {
  it("runs one project at a time until done, passing its cursor along", async () => {
    server.categorizeNextProject
      .mockResolvedValueOnce(step(0, "updated"))
      .mockResolvedValueOnce(step(1, "failed"))
      .mockResolvedValueOnce(step(2, "updated"))
      .mockResolvedValueOnce({ done: true });
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(
      await screen.findByText("Done. 2 categorized, 1 failed.")
    ).toBeTruthy();
    expect(
      server.categorizeNextProject.mock.calls.map(([arg]) => arg.data.after)
    ).toEqual([null, IDS[0], IDS[1], IDS[2]]);
    expect(invalidate).toHaveBeenCalled();
  });

  it("stops after the project in flight when Stop is pressed", async () => {
    const second = deferred<ReturnType<typeof step>>();
    server.categorizeNextProject
      .mockResolvedValueOnce(step(0, "updated"))
      .mockReturnValueOnce(second.promise);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() =>
      expect(server.categorizeNextProject).toHaveBeenCalledTimes(2)
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    second.resolve(step(1, "updated"));

    expect(
      await screen.findByText("2 of 3 done: 2 categorized, 0 failed.")
    ).toBeTruthy();
    expect(server.categorizeNextProject).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Start again" })).toBeTruthy();
  });

  it("stops and says why when a step fails", async () => {
    server.categorizeNextProject.mockRejectedValueOnce(
      new Error("Categorizing is turned off on this server.")
    );
    await openDialog();

    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(
      await screen.findByText("Categorizing is turned off on this server.")
    ).toBeTruthy();
    expect(server.categorizeNextProject).toHaveBeenCalledTimes(1);
  });
});
