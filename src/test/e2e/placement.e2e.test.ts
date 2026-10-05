import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { projectPrograms, projects } from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";
import {
  createFixtureProgram,
  createFixtureProject,
  fixtureName,
  userIdByEmail,
  withDb,
} from "./fixtures";

/**
 * The placement page keeps everything in the staff member's browser
 * (ADR-0056). These tests prove the two halves of that: no request the page
 * makes carries a student's data, and the workspace moves between browsers
 * only as the exported file. Every row is invented, on a domain nothing else
 * uses, so a match in a request can only have come from these files (#648).
 */

const DOMAIN = "placement-fixture.invalid";
const PROJECTS_CSV =
  "title,max_teams,min_students,max_students\nTide Clock,2,,\nRobot Arm,,2,3\n";
const BIDS_CSV = [
  "email,name,priority,project,comment,override,avoid",
  `ada@${DOMAIN},Ada Park,1,Tide Clock,"Tides, and\nclocks",,`,
  `ada@${DOMAIN},Ada Park,2,Robot Arm,,,Sam from lab`,
  `ben@${DOMAIN},Ben Ito,1,Robot Arm,,true,`,
].join("\n");
const STORAGE_KEY = "cs-capstone:placement:v1";

/** The Results tab's figure tiles (#701), there once a run has finished. */
const figures = (page: Page) =>
  page.getByRole("region", { name: "Placement figures" });

/** The Placed tile's value, as "2 of 2". */
const placedFigure = (page: Page, value: string) =>
  figures(page).getByText(value, { exact: true });

async function importFiles(page: Page) {
  await page.getByLabel("Projects CSV file").setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(PROJECTS_CSV),
  });
  await expect(
    page.getByRole("cell", { name: "Tide Clock", exact: true })
  ).toBeVisible();
  await page.getByRole("tab", { name: /Bids/ }).click();
  await page.getByLabel("Bids CSV file").setInputFiles({
    name: "bids.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(BIDS_CSV),
  });
  await expect(page.getByText("2 students and 3 bids")).toBeVisible();
}

const stored = (page: Page) =>
  page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);

test.describe("placement workspace", () => {
  test.use({ storageState: ADMIN_AUTH });

  test("staff import projects and bids, and no request carries a student's data", async ({
    page,
  }) => {
    const sent: string[] = [];
    page.on("request", (request) => {
      sent.push(`${request.url()}\n${request.postData() ?? ""}`);
    });
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);

    await page.getByRole("tab", { name: "Parameters" }).click();
    const min = page.getByLabel("Min students");
    await min.fill("2");
    await expect.poll(() => stored(page)).toContain('"minStudents":2');

    // A run too, so the worker and its WASM fetch are among the requests.
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(figures(page)).toBeVisible({
      timeout: 20_000,
    });
    expect(sent.some((r) => r.includes(".wasm"))).toBe(true);

    await page.getByRole("tab", { name: "Parameters" }).click();
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByLabel("Min students")).toHaveValue("2");
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(page.getByText("2 students and 3 bids")).toBeVisible();

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((r) => r.includes(DOMAIN))).toEqual([]);
    for (const text of ["Sam from lab", "Ada Park", "Ben Ito", "clocks"]) {
      expect(sent.filter((r) => r.includes(text))).toEqual([]);
    }
  });

  test("a program's projects bring who to contact, and a student-proposed badge (#715)", async ({
    page,
  }) => {
    const title = fixtureName("Placement contact");
    const mentor = `mentor@${DOMAIN}`;
    const program = await withDb(async (db) => {
      const created = await createFixtureProgram(db);
      const project = await createFixtureProject(db, {
        title,
        proposerId: await userIdByEmail(db, "user@example.com"),
        status: "published",
      });
      await db
        .update(projects)
        .set({ studentProposed: true, mentorEmail: mentor })
        .where(eq(projects.id, project.id));
      await db
        .insert(projectPrograms)
        .values({ programId: created.id, projectId: project.id });
      return created;
    });

    await page.goto("/admin/placement");
    await waitForHydration(page);
    await page.getByRole("combobox", { name: "Program" }).click();
    await page
      .getByRole("option", {
        name: `${program.courseId} ${program.courseName}`,
      })
      .click();
    await page.getByRole("button", { name: "Load published projects" }).click();
    const row = page.getByRole("row").filter({ hasText: title });
    await expect(row).toContainText("Student proposed");
    // Hidden until asked for, and the mentor for a student-proposed project.
    await expect(
      page.getByRole("columnheader", { name: /Contact/ })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Columns" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Contact" }).click();
    await page.keyboard.press("Escape");
    await expect(row).toContainText(mentor);
    await expect(row).toContainText("mentor");

    // A projects CSV carries the same, and says why a flag is unreadable.
    await page.getByRole("button", { name: "Remove projects" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove" })
      .click();
    await page.getByLabel("Projects CSV file").setInputFiles({
      name: "projects.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "title,proposer_name,proposer_email,student_proposed",
          "Tide Clock,Jane Doe,jane@example.com,no",
          "Moon Base,,,maybe",
        ].join("\n")
      ),
    });
    const tide = page.getByRole("row").filter({ hasText: "Tide Clock" });
    await expect(tide).toContainText("Jane Doe");
    await expect(tide).toContainText("jane@example.com, proposer");
    await expect(tide).not.toContainText("Student proposed");
    await expect(
      page.getByText(/student_proposed must be true or false/)
    ).toBeVisible();
  });

  test("staff add a project by hand and remove one from the list (#716)", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: /Projects/ }).click();

    const addProject = async (title: string) => {
      await page.getByRole("button", { name: "Add project" }).click();
      const dialog = page.getByRole("dialog", { name: "Add a project" });
      await dialog.getByLabel("Title").fill(title);
      await dialog.getByLabel("Max teams").fill("1");
      await dialog.getByLabel("Student proposed").click();
      await dialog.getByLabel("Mentor email").fill(`mentor@${DOMAIN}`);
      await dialog.getByRole("button", { name: "Add project" }).click();
      return dialog;
    };
    // A title already listed is refused, and the dialog stays open.
    const refused = await addProject("tide  CLOCK");
    await expect(refused).toContainText(
      "A project with this title is already in the list."
    );
    await refused.getByRole("button", { name: "Cancel" }).click();

    const added = await addProject("Moon Base");
    await expect(added).toHaveCount(0);
    const moon = page.getByRole("row").filter({ hasText: "Moon Base" });
    await expect(moon).toContainText("Added by hand");
    await expect(moon).toContainText("Student proposed");
    await expect(
      page.getByText("3 projects from projects.csv, 1 of them added by hand.")
    ).toBeVisible();

    // A pin set on this page to a project that then goes stays, and the run
    // leaves that student unplaced rather than guessing.
    await page.getByRole("tab", { name: /Bids/ }).click();
    await page.getByRole("button", { name: "Per project" }).click();
    await page
      .getByRole("button", { name: /^Pin Ada Park to Tide Clock/ })
      .click();
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");
    await page.getByRole("tab", { name: "Parameters" }).click();
    await page.getByLabel("Min students per team", { exact: true }).fill("1");
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "2 of 2")).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByRole("button", { name: "More for Tide Clock" }).click();
    await page.getByRole("menuitem", { name: "Remove..." }).click();
    const confirm = page.getByRole("alertdialog", {
      name: "Remove Tide Clock?",
    });
    await expect(confirm).toContainText(
      "The 1 bid on it shows as an unmatched title again."
    );
    await confirm.getByRole("button", { name: "Remove" }).click();
    await expect(
      page.getByRole("cell", { name: "Robot Arm", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: "Tide Clock" })
    ).toHaveCount(0);

    // The run placed Ada on Tide Clock, so it goes with the project rather
    // than show a project the list no longer has.
    await page.getByRole("tab", { name: "Results" }).click();
    await page
      .getByRole("button", { name: "Run placement", exact: true })
      .click();
    await expect(placedFigure(page, "1 of 2")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("row", { name: /Ada Park/ }).first()
    ).toContainText("Pinned to a project with no teams.");
    await expect.poll(() => stored(page)).toContain('"addedByHand":true');
  });

  test("staff build a project list by hand from the empty tab (#716)", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await page.getByRole("button", { name: "Add project" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a project" });
    await dialog.getByLabel("Title").fill("...");
    await dialog.getByRole("button", { name: "Add project" }).click();
    await expect(dialog).toContainText("Enter a title with letters or digits.");
    await dialog.getByLabel("Title").fill("Moon Base");
    await dialog.getByRole("button", { name: "Add project" }).click();
    await expect(page.getByText("1 project, added by hand.")).toBeVisible();
    await page.reload();
    await waitForHydration(page);
    await expect(page.getByText("1 project, added by hand.")).toBeVisible();
  });

  test("an exported workspace imports identically in a fresh browser", async ({
    browser,
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    const original = await stored(page);
    expect(original).not.toBeNull();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export workspace" }).click();
    const file = await (await download).path();
    const exported = await readFile(file, "utf-8");

    const fresh = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const other = await fresh.newPage();
      await other.goto("/admin/placement");
      await waitForHydration(other);
      expect(await stored(other)).toBeNull();
      await other.getByLabel("Workspace file").setInputFiles({
        name: "workspace.json",
        mimeType: "application/json",
        buffer: Buffer.from(exported),
      });
      await expect(other.getByRole("tab", { name: "Bids (2)" })).toBeVisible();
      // Compared as values: the import rebuilds the object in its schema's
      // key order, so the two strings need not match byte for byte.
      await expect
        .poll(async () => JSON.parse((await stored(other)) ?? "null"))
        .toEqual(JSON.parse(original ?? "null"));
    } finally {
      await fresh.close();
    }
  });

  test("a Qualtrics export converts on upload, and the converted file re-imports to the same bids", async ({
    page,
  }) => {
    const ids = [
      "status",
      "finished",
      "recordedDate",
      "recipientLastName",
      "recipientFirstName",
      "recipientEmail",
      "QID30_1",
      "QID30_2",
      "QID3_11",
      "QID3_12",
    ];
    const questions = [
      "Response Type",
      "Finished",
      "Recorded Date",
      "Recipient Last Name",
      "Recipient First Name",
      "Recipient Email",
      "Rank your top 6 choices. - Tide Clock",
      "Rank your top 6 choices. - Robot Arm:",
      "Tell us why. - reason for choice 1",
      "Tell us why. - reason for choice 2",
    ];
    const quote = (cells: string[]) =>
      cells.map((c) => `"${c.replaceAll('"', '""')}"`).join(",");
    const survey = [
      quote(ids.map((_, i) => `Q${i}`)),
      quote(questions),
      quote(ids.map((id) => JSON.stringify({ ImportId: id }))),
      quote([
        "IP Address",
        "True",
        "2026-09-28 10:00:00",
        "Park",
        "Ada",
        `ada@${DOMAIN}`,
        "2",
        "1",
        "Robots, mostly",
        "Tides",
      ]),
      quote([
        "IP Address",
        "True",
        "2026-09-28 11:00:00",
        "Ito",
        "Ben",
        `ben@${DOMAIN}`,
        "1",
        "",
        "Clocks",
        "",
      ]),
    ].join("\n");

    await page.goto("/admin/placement");
    await waitForHydration(page);
    await page.getByLabel("Projects CSV file").setInputFiles({
      name: "projects.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(PROJECTS_CSV),
    });
    await page.getByRole("tab", { name: /Bids/ }).click();
    await page.getByLabel("Bids CSV file").setInputFiles({
      name: "survey.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(survey),
    });
    await expect(
      page.getByText("Converted from the Qualtrics export survey.csv.")
    ).toBeVisible();
    await expect(page.getByText("2 students and 3 bids")).toBeVisible();
    await expect(page.getByText("Robots, mostly")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download converted CSV" }).click();
    const converted = await readFile(await (await download).path(), "utf-8");

    await page.getByRole("button", { name: "Remove bids" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove" })
      .click();
    await page.getByLabel("Bids CSV file").setInputFiles({
      name: "converted.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(converted),
    });
    await expect(page.getByText("2 students and 3 bids")).toBeVisible();
    await expect(page.getByText("Robots, mostly")).toBeVisible();
  });

  test("a workspace saved before plugins converted on read still shows its conversion", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    // What the build before #733 saved for a Qualtrics upload: the converted
    // CSV as the text, the export's name and what converting it noticed.
    await page.evaluate(
      ([key, text]) => {
        const workspace = JSON.parse(window.localStorage.getItem(key) ?? "{}");
        workspace.bids = {
          filename: "survey (converted).csv",
          text,
          convertedFrom: "survey.csv",
          conversionIssues: [
            {
              level: "warning",
              row: 4,
              message: "A survey preview, not a response; skipped.",
            },
          ],
        };
        window.localStorage.setItem(key, JSON.stringify(workspace));
      },
      [STORAGE_KEY, BIDS_CSV] as const
    );
    await page.reload();
    await waitForHydration(page);
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(page.getByText("2 students and 3 bids")).toBeVisible();
    await expect(
      page.getByText("Converted from the Qualtrics export survey.csv.")
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Download converted CSV" })
    ).toBeVisible();
    await expect(
      page.getByRole("region", {
        name: "Problems in the Qualtrics export file",
      })
    ).toContainText("A survey preview, not a response; skipped.");
    // Converted text is read by no plugin again, so there is nothing to
    // choose.
    await expect(page.getByLabel("Read as")).toHaveCount(0);
  });

  test("staff run, approve, move, re-run and download a placement", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: "Parameters" }).click();
    await page.getByLabel("Min students").fill("1");
    // Robot Arm's own minimum is 2, which would leave pinned Ada alone and
    // the re-run infeasible once Ben moves; this test is about the flow.
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "2 of 2")).toBeVisible({
      timeout: 20_000,
    });
    // One team per project: Ada on Tide Clock, pinned Ben on Robot Arm.
    await expect(figures(page).getByText("every team 1")).toBeVisible();
    await expect(page.getByText(/^Ran at /)).toBeVisible();
    // Every student on Robot Arm is pinned, so it starts folded (#713).
    const robotArm = page.getByRole("button", { name: "Robot Arm" });
    const tideClock = page.getByRole("button", { name: "Tide Clock" });
    await expect(robotArm).toHaveAttribute("aria-expanded", "false");
    await expect(tideClock).toHaveAttribute("aria-expanded", "true");

    // Approving Tide Clock's last student folds it, and the focus lands on
    // its chevron rather than falling to the page.
    await page.getByRole("button", { name: "Approve Ada Park here" }).click();
    await expect(tideClock).toHaveAttribute("aria-expanded", "false");
    await expect(tideClock).toBeFocused();
    await tideClock.click();
    await expect(
      page.getByRole("button", { name: "Unpin Ada Park" })
    ).toBeVisible();
    await page.reload();
    await waitForHydration(page);
    // Which projects were opened by hand is not saved.
    await expect(tideClock).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(
      page.getByRole("button", { name: "Unpin Ada Park" })
    ).toBeVisible();

    // Move searches by any word of a title (#678). Ben is on Robot Arm, so
    // it is not offered to him.
    await page.getByRole("combobox", { name: "Move Ben Ito" }).click();
    const search = page.getByRole("combobox", { name: "Search projects" });
    await search.fill("robot");
    await expect(page.getByText("No project matches.")).toBeVisible();
    await search.fill("clock");
    await page.getByRole("option", { name: "Tide Clock" }).click();
    await expect(page.getByText(/moved by hand/)).toBeVisible();
    // The figures follow the Move without a run (#701).
    await expect(figures(page).getByText("every team 2")).toBeVisible();
    await page.getByRole("button", { name: "Run placement again" }).click();
    await expect(page.getByText(/moved by hand/)).toBeHidden({
      timeout: 20_000,
    });
    // A new run starts every project over: Tide Clock is all pinned again.
    await expect(tideClock).toHaveAttribute("aria-expanded", "false");
    await tideClock.click();
    await expect(
      page.getByRole("rowgroup").filter({ has: tideClock }).getByText("Ben Ito")
    ).toBeVisible();

    const placement = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download placement" }).click();
    const placed = await readFile(await (await placement).path(), "utf-8");
    expect(placed).toContain(`ben@${DOMAIN},Ben Ito,Tide Clock,1`);

    // The same placement as a Canvas group set import (#734).
    await page.getByRole("combobox", { name: "Download as" }).click();
    await page.getByRole("option", { name: "Canvas groups" }).click();
    await expect(
      page.getByText(/Canvas matches each student by their login/)
    ).toBeVisible();
    const canvas = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download placement" }).click();
    const download = await canvas;
    expect(download.suggestedFilename()).toMatch(
      /^placement-\d{4}-\d{2}-\d{2} \(Canvas groups\)\.csv$/
    );
    const groups = (await readFile(await download.path(), "utf-8"))
      .replace(/^﻿/, "")
      .split("\r\n");
    expect(groups[0]).toBe("name,login_id,group_name");
    expect(groups).toContainEqual(
      expect.stringMatching(`^Ben Ito,ben@${DOMAIN},Tide Clock`)
    );

    const withPins = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download bids with pins" }).click();
    const bids = await readFile(await (await withPins).path(), "utf-8");
    expect(bids).toContain(`ben@${DOMAIN},Ben Ito,,Tide Clock,,true,`);
  });

  test("staff open a student's bids on the board and move them to one", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    // Ada alone can form a Tide Clock team, so only her pin can keep her
    // off her first choice once the placement runs again.
    await page.getByRole("tab", { name: "Parameters" }).click();
    await page.getByLabel("Min students").fill("1");
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "2 of 2")).toBeVisible({
      timeout: 20_000,
    });

    // Ben is pinned, so Robot Arm starts folded (#713).
    await page.getByRole("button", { name: "Expand all" }).click();
    const toggle = page.getByRole("button", { name: "Ada Park, 2 bids" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Opening re-renders the row, not remounts it, so focus stays put.
    await expect(toggle).toBeFocused();
    const bids = page.getByRole("region", { name: "Bids of Ada Park" });
    const tide = bids.getByRole("listitem").filter({ hasText: "Tide Clock" });
    await expect(tide).toContainText("Placed here");
    await expect(tide).toContainText("Tides, and clocks");
    // Several open at once.
    await page.getByRole("button", { name: "Ben Ito, 1 bid" }).click();
    await expect(
      page.getByRole("region", { name: "Bids of Ben Ito" })
    ).toContainText("Placed here");

    await bids
      .getByRole("button", { name: "Move here: Ada Park to Robot Arm" })
      .click();
    await expect(page.getByText(/moved by hand/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unpin Ada Park" })
    ).toBeVisible();
    await expect(
      bids.getByRole("listitem").filter({ hasText: "Robot Arm" })
    ).toContainText("Placed here");

    await page.getByRole("button", { name: "Run placement again" }).click();
    await expect(page.getByText(/moved by hand/)).toBeHidden({
      timeout: 20_000,
    });
    // Ada and Ben are both pinned to Robot Arm now, which folds it.
    const robotArm = page.getByRole("button", { name: "Robot Arm" });
    await expect(robotArm).toHaveAttribute("aria-expanded", "false");
    await robotArm.click();
    await expect(
      page
        .getByRole("rowgroup")
        .filter({ has: robotArm })
        .getByText("Ada Park", { exact: true })
    ).toBeVisible();
    // A project that forms no team offers no Move here, and the open list
    // follows the Projects tab.
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Max teams, Tide Clock").fill("0");
    await page.getByRole("tab", { name: "Results" }).click();
    await expect(tide).toContainText("No teams");
    await expect(tide.getByRole("button")).toHaveCount(0);
    await toggle.click();
    await expect(bids).toHaveCount(0);
  });

  test("an infeasible re-run explains itself and keeps the last placement", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "2 of 2")).toBeVisible({
      timeout: 20_000,
    });

    // Both students are on Robot Arm, whose minimum is 2. Pinning Ada there
    // and Ben elsewhere leaves each pinned project short of its minimum.
    await page.getByRole("button", { name: "Approve Ada Park here" }).click();
    // Ben's pin comes from the file, so Robot Arm is now all pinned and
    // folds (#713).
    await page.getByRole("button", { name: "Robot Arm" }).click();
    await page.getByRole("combobox", { name: "Move Ben Ito" }).click();
    await page.getByRole("option", { name: "Tide Clock" }).click();
    // An input change as well, as when a co-instructor lowered a project's
    // max teams and read the old board as the new run (#680).
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Max teams, Tide Clock").fill("1");
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement again" }).click();

    // The failure is an alert, and the board under it says it is the older
    // run rather than asking for the run that just failed (#680).
    const alert = page.getByRole("alert").filter({
      hasText: "No placement satisfies every rule at once.",
    });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).toContainText(
      "The board below still shows the last run that worked, not this one."
    );
    await expect(
      page.getByRole("heading", { name: /^Last run that worked, / })
    ).toBeVisible();
    await expect(
      page.getByText(/Run placement again to use them/)
    ).toBeHidden();
    await expect(placedFigure(page, "2 of 2")).toBeVisible();
  });

  test("an export that lost its ImportId row still converts, and one with no email says why it cannot", async ({
    page,
  }) => {
    const quote = (cells: string[]) =>
      cells.map((c) => `"${c.replaceAll('"', '""')}"`).join(",");
    // Two header rows, as a hand-edited export has (#681), with the trailing
    // unnamed columns Qualtrics writes.
    const header = (withEmail: boolean) => [
      quote([
        "RecipientLastName",
        ...(withEmail ? ["RecipientEmail"] : []),
        " _1",
        " _2",
        "",
        " ",
      ]),
      quote([
        "Recipient Last Name",
        ...(withEmail ? ["Recipient Email"] : []),
        "Rank your top 6 choices. - Tide Clock",
        "Rank your top 6 choices. - Robot Arm",
        "",
        "",
      ]),
    ];
    const edited = [
      ...header(true),
      quote(["Park", `ada@${DOMAIN}`, "1", "2", "", ""]),
      quote(["Ito", `ben@${DOMAIN}`, "", "1", "", ""]),
    ].join("\n");

    await page.goto("/admin/placement");
    await waitForHydration(page);
    await page.getByLabel("Projects CSV file").setInputFiles({
      name: "projects.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(PROJECTS_CSV),
    });
    await page.getByRole("tab", { name: /Bids/ }).click();
    await page.getByLabel("Bids CSV file").setInputFiles({
      name: "edited.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(edited),
    });
    await expect(
      page.getByText("Converted from the Qualtrics export edited.csv.")
    ).toBeVisible();
    await expect(page.getByText("2 students and 3 bids")).toBeVisible();
    await expect(
      page.getByText(/The export has no ImportId row/)
    ).toBeVisible();

    await page.getByRole("button", { name: "Remove bids" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove" })
      .click();
    await page.getByLabel("Bids CSV file").setInputFiles({
      name: "no-email.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [...header(false), quote(["Park", "1", "2", "", ""])].join("\n")
      ),
    });
    const problems = page.getByRole("region", {
      name: "Problems in the Qualtrics export file",
    });
    await expect(problems).toContainText(
      "The Qualtrics export file was not read"
    );
    await expect(problems).toContainText(
      "The export has no Recipient Email column"
    );
    await expect(
      page.getByRole("region", { name: "Problems in the bids file" })
    ).toHaveCount(0);
  });

  test("the analytics Sheet downloads each of its tables", async ({ page }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(figures(page)).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Analytics" }).click();
    const sheet = page.getByRole("dialog", { name: "Placement analytics" });

    // Both students land on Robot Arm; Tide Clock's minimum of 3 leaves it
    // without a team, so four sections have rows and one says it has none.
    const headers: Record<string, string> = {
      "bids per project": "project,first_choice_bids,total_bids",
      "priority distribution":
        "priority,students,percent_of_placed,percent_of_all",
      "team sizes": "students_per_team,teams,students",
      "projects with no team formed": "project",
    };
    for (const [table, header] of Object.entries(headers)) {
      const download = page.waitForEvent("download");
      await sheet
        .getByRole("button", { name: `Download ${table} as CSV` })
        .click();
      const text = await readFile(await (await download).path(), "utf-8");
      expect(text.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe(header);
    }
    await expect(sheet.getByText("Every student is placed.")).toBeVisible();
    await expect(
      sheet.getByText("1 team, 2.0 students per team on average.")
    ).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
  });

  test("staff match a survey title to a project, and undo it", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await page.getByLabel("Projects CSV file").setInputFiles({
      name: "projects.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(PROJECTS_CSV),
    });
    await page.getByRole("tab", { name: /Bids/ }).click();
    await page.getByLabel("Bids CSV file").setInputFiles({
      name: "bids.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "email,name,priority,project",
          `ada@${DOMAIN},Ada Park,1,Tide Clok`,
          `ben@${DOMAIN},Ben Ito,1,Tide Clok`,
          `ben@${DOMAIN},Ben Ito,2,Moon Base`,
        ].join("\n")
      ),
    });
    const unmatched = page.getByRole("region", { name: "Unmatched titles" });
    await expect(unmatched).toContainText("2 titles match no project");
    await expect(page.getByText("0 students and 0 bids")).toBeVisible();

    // "Tide Clok" is close enough to be suggested; "Moon Base" is not.
    await expect(
      unmatched.getByRole("combobox", { name: 'Project for "Tide Clok"' })
    ).toContainText("Tide Clock");
    await expect(
      unmatched.getByRole("button", { name: 'Match "Moon Base"' })
    ).toBeDisabled();
    await unmatched.getByRole("button", { name: 'Match "Tide Clok"' }).click();

    await expect(page.getByText("2 students and 2 bids")).toBeVisible();
    const matched = page.getByRole("region", {
      name: "Titles matched by hand",
    });
    await expect(matched).toContainText('"Tide Clok" matched to Tide Clock');
    await expect(unmatched).toContainText("1 title matches no project");
    await expect.poll(() => stored(page)).toContain('"titleMatches"');

    await page.reload();
    await waitForHydration(page);
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(page.getByText("2 students and 2 bids")).toBeVisible();

    await matched
      .getByRole("button", { name: 'Undo the match for "Tide Clok"' })
      .click();
    await expect(page.getByText("0 students and 0 bids")).toBeVisible();
    await expect(matched).toHaveCount(0);
    await expect.poll(() => stored(page)).not.toContain('"titleMatches"');

    // The bulk action takes only the suggested title; one with no
    // suggestion is matched by picking its project by hand.
    await unmatched
      .getByRole("button", { name: "Match all suggestions" })
      .click();
    await expect(matched).toContainText('"Tide Clok" matched to Tide Clock');
    await expect(unmatched).toContainText("1 title matches no project");
    await unmatched
      .getByRole("combobox", { name: 'Project for "Moon Base"' })
      .click();
    await page.getByRole("option", { name: /^Robot Arm/ }).click();
    await unmatched.getByRole("button", { name: 'Match "Moon Base"' }).click();
    await expect(matched).toContainText('"Moon Base" matched to Robot Arm');
    await expect(unmatched).toHaveCount(0);
    await expect(page.getByText("2 students and 3 bids")).toBeVisible();
  });

  test("a class roster adds the students who did not answer the survey", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);

    await page.getByRole("tab", { name: /Roster/ }).click();
    await page.getByLabel("Roster CSV file").setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `email,name\nADA@${DOMAIN},Ada Park\nkim@${DOMAIN},Kim Lee\n`
      ),
    });
    const roster = page.getByRole("region", { name: /Class roster/ });
    await expect(roster).toContainText("2 students from roster.csv");
    await expect(roster).toContainText(
      "1 student on the roster did not answer the survey"
    );
    // Ben answered the survey but is not on this roster.
    await expect(roster).toContainText(`ben@${DOMAIN}`);
    await expect(page.getByRole("tab", { name: "Roster (2)" })).toBeVisible();
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(
      page.getByText("and 1 more from the roster with no bids")
    ).toBeVisible();
    // The Bids tab points at the roster rather than holding it (#717).
    await expect(
      page.getByText(
        "1 student on the roster has no bids and 1 student who bid is not on the roster. See the Roster tab."
      )
    ).toBeVisible();
    await expect(
      page.getByRole("rowheader", { name: /Kim Lee.*not in the survey/ })
    ).toBeVisible();
    await expect.poll(() => stored(page)).toContain('"roster"');

    await page.getByRole("link", { name: "Roster tab" }).click();
    await expect(page).toHaveURL(/tab=roster/);
    await roster.getByRole("button", { name: "Remove roster" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Roster" })).toBeVisible();
    await page.getByRole("tab", { name: /Bids/ }).click();
    // The panel first: a count of none passes before it renders.
    await expect(
      page.getByRole("rowheader", { name: /Ada Park/ })
    ).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /Kim Lee/ })).toHaveCount(
      0
    );
    await expect(page.getByRole("link", { name: "Roster tab" })).toHaveCount(0);
    await page.getByRole("tab", { name: /Roster/ }).click();

    await page
      .getByLabel("Roster emails")
      .fill(`ada@${DOMAIN}, ben@${DOMAIN}\nKim Lee <kim@${DOMAIN}>\nnobody`);
    await page.getByRole("button", { name: "Use these emails" }).click();
    await expect(roster).toContainText("3 students from a pasted list");
    await expect(
      page.getByRole("region", { name: "Problems in the pasted roster" })
    ).toContainText('Line 3: "nobody" is not an email.');
    await expect(roster).not.toContainText("not on the roster");
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(
      page.getByRole("rowheader", { name: /Kim Lee.*not in the survey/ })
    ).toBeVisible();
  });

  test("the Roster tab opens from its URL and takes a roster before any bids (#717)", async ({
    page,
  }) => {
    await page.goto("/admin/placement?tab=roster");
    await waitForHydration(page);
    await expect(page.getByRole("tab", { name: "Roster" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await page
      .getByLabel("Roster emails")
      .fill(`ada@${DOMAIN}\nKim Lee <kim@${DOMAIN}>`);
    await page.getByRole("button", { name: "Use these emails" }).click();
    const roster = page.getByRole("region", { name: /Class roster/ });
    await expect(roster).toContainText("2 students from a pasted list");
    await expect(
      page.getByText(/matched once the projects are loaded/)
    ).toBeVisible();
    await expect(roster).toContainText(
      "Load the projects, then the bids, to match the roster against them."
    );
    await expect(page.getByRole("tab", { name: "Roster (2)" })).toBeVisible();
    await roster.getByRole("button", { name: "Remove roster" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByLabel("Roster emails")).toBeVisible();
  });

  test("a run places a roster student who did not answer the survey", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: /Roster/ }).click();
    await page
      .getByLabel("Roster emails")
      .fill(`ada@${DOMAIN}\nben@${DOMAIN}\nKim Lee <kim@${DOMAIN}>`);
    await page.getByRole("button", { name: "Use these emails" }).click();
    await page.getByRole("tab", { name: "Parameters" }).click();
    await page.getByLabel("Min students").fill("1");
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");

    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "3 of 3")).toBeVisible({
      timeout: 20_000,
    });
    await expect(
      page.getByRole("row", { name: /Kim Lee.*Not in the survey/ })
    ).toBeVisible();
    // Kim is listed on the card at the top (#714), with the board's actions,
    // and stays there once pinned: a Move from the card pins too.
    const card = page.getByRole("region", { name: /Not in the survey/ });
    await expect(card).toContainText("1 student");
    await expect(card.getByRole("row", { name: /Kim Lee/ })).toContainText(
      /of \d/
    );
    await card.getByRole("button", { name: "Approve Kim Lee here" }).click();
    await expect(
      page.getByRole("row", { name: /Kim Lee.*Pinned, not in the survey/ })
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Unpin Kim Lee" })
    ).toBeVisible();
    await card.getByRole("combobox", { name: "Move Kim Lee" }).click();
    const target = page.getByRole("option").first();
    const targetTitle = (await target.textContent()) ?? "";
    await target.click();
    await expect(card.getByRole("row", { name: /Kim Lee/ })).toContainText(
      `${targetTitle}, team 1, pinned`
    );
    // The board follows the card.
    await expect(
      page
        .getByRole("rowgroup")
        .filter({ has: page.getByRole("button", { name: targetTitle }) })
        .getByRole("row", { name: /Kim Lee/ })
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Unpin Kim Lee" })
    ).toBeVisible();
    // The card folds, and opens again.
    const fold = card.getByRole("button", { name: "Not in the survey" });
    await fold.click();
    await expect(card.getByRole("row")).toHaveCount(0);
    await fold.click();
    await page.getByRole("button", { name: "Kim Lee, 0 bids" }).click();
    await expect(
      page.getByRole("region", { name: "Bids of Kim Lee" })
    ).toHaveText("Not in the survey; no bids.");

    const placement = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download placement" }).click();
    const placed = await readFile(await (await placement).path(), "utf-8");
    expect(placed).toMatch(
      new RegExp(
        `kim@${DOMAIN.replaceAll(".", "\\.")},Kim Lee,[^,]+,\\d,not in the survey`
      )
    );

    // Removing the roster takes Kim out of the run, so the run goes too
    // rather than leaving Kim's placement to vanish from the board.
    await page.getByRole("tab", { name: /Roster/ }).click();
    await page.getByRole("button", { name: "Remove roster" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("tab", { name: "Results" }).click();
    await expect(
      page.getByRole("button", { name: "Run placement", exact: true })
    ).toBeVisible();
    await expect.poll(() => stored(page)).not.toContain(`kim@${DOMAIN}`);
  });

  test("roster pre-approvals pin students, and add a project the list lacks", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: /Roster/ }).click();
    await page.getByLabel("Roster CSV file").setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "email,name,project",
          `ada@${DOMAIN},Ada Park,Robot Arm`,
          `ben@${DOMAIN},Ben Ito,Tide Clock`,
          `kim@${DOMAIN},Kim Lee,Sponsor Lab`,
          `lou@${DOMAIN},Lou Ma,Tide Clok`,
        ].join("\n")
      ),
    });
    const roster = page.getByRole("region", { name: /Class roster/ });
    await expect(roster).toContainText("4 students are pre-approved");
    // The bids file pins Ben to Robot Arm; the roster wins, and says so.
    await expect(
      page.getByRole("note", { name: "Pre-approvals over a pin from the bids" })
    ).toContainText(
      `ben@${DOMAIN} is pre-approved for Tide Clock, over the bids file's pin to Robot Arm.`
    );
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(
      page.getByRole("rowheader", {
        name: /Ada Park.*pre-approved for Robot Arm/,
      })
    ).toBeVisible();

    await page.getByRole("tab", { name: /Projects/ }).click();
    const added = page.getByRole("region", { name: "Added from the roster" });
    await expect(added).toContainText("Sponsor Lab");
    await expect(added).toContainText("Tide Clok");
    await added
      .getByRole("button", { name: "Match to Tide Clock instead" })
      .click();
    await expect(added).not.toContainText("Tide Clok");
    const parameters = page.getByRole("tab", { name: "Parameters" });
    await parameters.click();
    await expect(parameters).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Min students").fill("1");
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");

    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "4 of 4")).toBeVisible({
      timeout: 20_000,
    });
    // Every student is pre-approved, so every project starts folded.
    await expect(
      page.getByRole("button", { name: "Robot Arm", expanded: false })
    ).toBeVisible();
    await page.getByRole("button", { name: "Expand all" }).click();
    const group = (label: string) =>
      page
        .getByRole("rowgroup")
        .filter({ has: page.getByRole("button", { name: label }) });
    await expect(
      group("Robot Arm").getByRole("row", {
        name: /Ada Park.*Pre-approved/,
      })
    ).toBeVisible();
    await expect(
      group("Sponsor Lab").getByRole("row", {
        name: /Kim Lee.*Pre-approved/,
      })
    ).toBeVisible();
    await expect(
      group("Tide Clock").getByRole("row", {
        name: /Lou Ma.*Pre-approved/,
      })
    ).toBeVisible();
    await expect(
      group("Tide Clock").getByRole("row", {
        name: /Ben Ito.*Pre-approved/,
      })
    ).toBeVisible();

    // Unpinning a pre-approved student on the board overrides the roster,
    // and the Bids tab says so rather than dropping the pre-approval quietly.
    await page.getByRole("button", { name: "Unpin Ada Park" }).click();
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(
      page.getByRole("note").filter({
        hasText: "Pre-approved for Robot Arm on the roster, but a pin set",
      })
    ).toBeVisible();
  });

  test("a roster nothing recognizes reads through a column mapping, which loads again in a fresh browser (#735)", async ({
    browser,
    page,
  }) => {
    const rosterFile = {
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "Student Email,Full Name,Team",
          `ada@${DOMAIN},Ada Park,Robot Arm`,
          `kim@${DOMAIN},Kim Lee,`,
        ].join("\n")
      ),
    };
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: /Roster/ }).click();
    await page.getByLabel("Roster CSV file").setInputFiles(rosterFile);
    const roster = page.getByRole("region", { name: /Class roster/ });
    await expect(roster).toContainText("No format on this page recognized");
    await roster.getByRole("button", { name: "Map columns" }).click();

    const editor = page.getByRole("region", {
      name: "Map the columns of roster.csv",
    });
    const apply = editor.getByRole("button", { name: "Apply column mapping" });
    await expect(apply).toBeDisabled();
    const choose = async (column: string, header: string) => {
      await editor
        .getByRole("combobox", { name: `File column for ${column}` })
        .click();
      await page.getByRole("option", { name: header, exact: true }).click();
    };
    await choose("email", "Student Email");
    await choose("name", "Full Name");
    await choose("project", "Team");
    await expect(editor.getByRole("table")).toContainText(`ada@${DOMAIN}`);
    await apply.click();

    await expect(roster).toContainText("2 students from roster.csv");
    await expect(roster).toContainText("1 student is pre-approved");
    await expect(roster).toContainText("Converted from the column-mapped");
    await expect.poll(() => stored(page)).toContain('"custom-mapping-roster"');

    // Read as another format keeps the column mapping, and choosing it
    // again reads through it with no editor.
    const readAs = roster.getByRole("combobox", { name: "Read as" });
    await readAs.click();
    await page.getByRole("option", { name: "Roster CSV" }).click();
    await expect(roster).toContainText("0 students from roster.csv");
    await readAs.click();
    await page.getByRole("option", { name: "Column mapping" }).click();
    await expect(roster).toContainText("2 students from roster.csv");
    await expect(
      page.getByRole("region", { name: "Map the columns of roster.csv" })
    ).toHaveCount(0);

    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(
      page.getByRole("rowheader", {
        name: /Ada Park.*pre-approved for Robot Arm/,
      })
    ).toBeVisible();
    await expect(
      page.getByText("and 1 more from the roster with no bids")
    ).toBeVisible();

    await page.getByRole("tab", { name: /Roster/ }).click();
    const download = page.waitForEvent("download");
    await roster
      .getByRole("button", { name: "Download column mapping" })
      .click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe("roster (column mapping).json");
    const mapping = await readFile(await saved.path(), "utf-8");
    const rosterOf = async (p: Page) =>
      JSON.parse((await stored(p)) ?? "null")?.roster;
    const original = await rosterOf(page);

    // A fresh workspace, the same file, and the downloaded mapping.
    const fresh = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const other = await fresh.newPage();
      await other.goto("/admin/placement?tab=roster");
      await waitForHydration(other);
      await other.getByLabel("Roster CSV file").setInputFiles(rosterFile);
      const otherRoster = other.getByRole("region", { name: /Class roster/ });
      await otherRoster.getByRole("button", { name: "Map columns" }).click();
      await other.getByLabel("Column mapping file").setInputFiles({
        name: "roster (column mapping).json",
        mimeType: "application/json",
        buffer: Buffer.from(mapping),
      });
      await other.getByRole("button", { name: "Apply column mapping" }).click();
      await expect(otherRoster).toContainText("2 students from roster.csv");
      await expect.poll(() => rosterOf(other)).toEqual(original);

      // A file without one of the mapped headers names it.
      await otherRoster.getByRole("button", { name: "Remove roster" }).click();
      await other.getByRole("button", { name: "Remove", exact: true }).click();
      await other.getByLabel("Roster CSV file").setInputFiles({
        ...rosterFile,
        buffer: Buffer.from(`Student Email,Full Name\nlou@${DOMAIN},Lou Ma`),
      });
      await otherRoster.getByRole("button", { name: "Map columns" }).click();
      await other.getByLabel("Column mapping file").setInputFiles({
        name: "roster (column mapping).json",
        mimeType: "application/json",
        buffer: Buffer.from(mapping),
      });
      const missing = other
        .getByRole("status")
        .filter({ hasText: 'no "Team" (project)' });
      await expect(missing).toBeVisible();
      // Another column's choice leaves the warning, and Apply goes ahead
      // without the optional column.
      await other
        .getByRole("combobox", { name: "File column for name" })
        .click();
      await other.getByRole("option", { name: "Not in the file" }).click();
      await expect(missing).toBeVisible();
      await other.getByRole("button", { name: "Apply column mapping" }).click();
      await expect(otherRoster).toContainText("1 student from roster.csv");
    } finally {
      await fresh.close();
    }
  });

  test("staff read the bids per project and pin a student from there", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("button", { name: "Per project" }).click();
    await expect(page).toHaveURL(/view=project/);
    // Anchored to the header: another group's row can name the project.
    const tide = page.getByRole("rowgroup").filter({ hasText: /^Tide Clock/ });
    await expect(tide).toContainText("1 bid, 1 first choice");
    await expect(tide).toContainText("Tides, and");

    await tide
      .getByRole("button", { name: "Pin Ada Park to Tide Clock" })
      .click();
    await expect(
      tide.getByRole("button", { name: "Unpin Ada Park" })
    ).toBeVisible();
    const robot = page.getByRole("rowgroup").filter({ hasText: /^Robot Arm/ });
    await expect(robot.getByText("Pinned elsewhere")).toBeVisible();
    // Only Tide Clock's own group names it, so a search lands there.
    await expect(robot).not.toContainText("Tide Clock");

    // Ben is pinned by the bids file; Ada now by the board.
    await expect(page.getByText(/2 pinned\./)).toBeVisible();
    // Each header names who is pinned there and how (#688).
    await expect(tide).toContainText("Pinned: Ada Park (1st)");
    await expect(robot).toContainText("Pinned: Ben Ito (1st)");

    // Pinned only leaves each project's pins, and survives a reload.
    await page.getByRole("switch", { name: "Pinned only" }).click();
    await expect(page).toHaveURL(/pinnedOnly=true/);
    await expect(robot.getByText("Pinned elsewhere")).toHaveCount(0);
    await expect(robot.getByText("Ben Ito", { exact: true })).toBeVisible();
    await page.reload();
    await waitForHydration(page);
    await expect(
      page.getByRole("switch", { name: "Pinned only" })
    ).toBeChecked();
    await expect(robot.getByText("Ben Ito", { exact: true })).toBeVisible();
    await expect(robot.getByText("Pinned elsewhere")).toHaveCount(0);
    await page.getByRole("switch", { name: "Pinned only" }).click();
    await expect(robot.getByText("Pinned elsewhere")).toBeVisible();

    // The pin holds through a run, as an Approve on the board would.
    await page.getByRole("tab", { name: "Parameters" }).click();
    await page.getByLabel("Min students").fill("1");
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");
    await page.getByRole("tab", { name: "Results" }).click();
    await expect(page).toHaveURL(/view=project/);
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(figures(page)).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(
      page
        .getByRole("rowgroup")
        .filter({ has: page.getByRole("button", { name: "Tide Clock" }) })
        .getByRole("button", { name: "Unpin Ada Park" })
    ).toBeVisible();
    await page.getByRole("tab", { name: /Bids/ }).click();
    // Who the run placed on each project, and on which team (#693).
    await expect(tide).toContainText(
      "Placed: 1 student, 1 on their first choice"
    );
    await expect(
      tide.getByRole("row", { name: /Ada Park.*Placed here, team 1/ })
    ).toBeVisible();
    await expect(robot).toContainText(
      "Placed: 1 student, 1 on their first choice"
    );
    await expect(
      robot.getByRole("row", { name: /Ada Park/ })
    ).not.toContainText("Placed here");
    await page.getByRole("button", { name: "Per student" }).click();
    await expect(
      page.getByRole("row", { name: /Tide Clock.*pinned/ }).first()
    ).toBeVisible();
    await expect.poll(() => stored(page)).toContain(`"ada@${DOMAIN}":"`);
  });

  test("each student's bids say where they stand, and a pin set after a run", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: "Parameters" }).click();
    await page.getByLabel("Min students").fill("1");
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");
    await page.getByRole("tab", { name: /Bids/ }).click();
    // Anchored to the header, as a per-project group can name her too.
    const ada = page.getByRole("rowgroup").filter({ hasText: /^Ada Park/ });
    await expect(ada).toContainText("No run yet");

    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "2 of 2")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(ada).toContainText("Placed: Tide Clock, team 1 (1st)");
    await expect(
      ada.getByRole("row", { name: /Tide Clock \(placed\)/ })
    ).toBeVisible();
    // Ben's pin comes from the bids file, so only the pin shows.
    const ben = page.getByRole("rowgroup").filter({ hasText: /^Ben Ito/ });
    await expect(ben).toContainText("Pinned to Robot Arm");
    await expect(ben).not.toContainText("Placed:");

    // A pin set after the run shows alone, and says when it takes effect.
    await page.getByRole("button", { name: "Per project" }).click();
    await page
      .getByRole("button", { name: "Pin Ada Park to Robot Arm" })
      .click();
    const perStudent = page.getByRole("button", { name: "Per student" });
    await perStudent.click();
    await expect(perStudent).toHaveAttribute("aria-pressed", "true");
    await expect(ada).toContainText(
      "Pinned to Robot Arm, applies from the next run"
    );
    await expect(ada).not.toContainText("Placed:");
    await expect(
      ada.getByRole("row", { name: /Robot Arm \(pinned\)/ })
    ).toBeVisible();
  });

  test("a Canvas roster and groups export reads as a roster with pre-approvals", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await page.getByRole("tab", { name: /Roster/ }).click();
    await page.getByLabel("Roster CSV file").setInputFiles({
      name: "canvas-groups.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "name,canvas_user_id,user_id,login_id,sections,group_name,canvas_group_id,group_id",
          `Ada Park,101,9001,ada@${DOMAIN},CS 461,Tide Clock,55,7`,
          `Ben Ito,102,9002,ben@${DOMAIN},CS 461,,,`,
          `Kim Lee,103,9003,kim@${DOMAIN},CS 461,Team 3,56,8`,
        ].join("\n")
      ),
    });
    const roster = page.getByRole("region", { name: /Class roster/ });
    await expect(roster).toContainText(
      "Read as a Canvas roster and groups export"
    );
    await expect(roster).toContainText("2 students are pre-approved");

    // Read as the roster's own format, the file has no email column; back
    // to Canvas, it reads as before (#733).
    await roster.getByLabel("Read as").click();
    await page.getByRole("option", { name: "Roster CSV" }).click();
    await expect(
      roster.getByRole("region", { name: "Problems in the roster file" })
    ).toContainText('The file has no "email" column.');
    // Staff chose the format, so the page does not say nothing matched.
    await expect(roster).not.toContainText("No format on this page recognized");
    await roster.getByLabel("Read as").click();
    await page.getByRole("option", { name: "Canvas roster export" }).click();
    await expect(roster).toContainText("2 students are pre-approved");
    await page.getByRole("tab", { name: /Projects/ }).click();
    await expect(
      page.getByRole("region", { name: "Added from the roster" })
    ).toContainText("Team 3");

    const parameters = page.getByRole("tab", { name: "Parameters" });
    await parameters.click();
    await expect(parameters).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Min students").fill("1");
    // The bids file pins Ben alone to Robot Arm, whose own minimum is 2.
    await page.getByRole("tab", { name: /Projects/ }).click();
    await page.getByLabel("Min students per team, Robot Arm").fill("1");
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "3 of 3")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Expand all" }).click();
    await expect(
      page
        .getByRole("rowgroup")
        .filter({ has: page.getByRole("button", { name: "Team 3" }) })
        .getByRole("row", { name: /Kim Lee.*Pre-approved/ })
    ).toBeVisible();
  });

  test("staff remove students from placement, and restore them", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    // Kim is pre-approved for a project the list lacks, and Ben answered the
    // survey but is not on the roster, as a student who transferred out is.
    await page.getByRole("tab", { name: /Roster/ }).click();
    await page.getByLabel("Roster CSV file").setInputFiles({
      name: "roster.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        `email,name,project\nada@${DOMAIN},Ada Park,\nkim@${DOMAIN},Kim Lee,Moon Base\n`
      ),
    });
    const roster = page.getByRole("region", { name: /Class roster/ });
    await roster.getByRole("button", { name: "Remove this student" }).click();
    const removed = page.getByRole("region", {
      name: /Removed from placement/,
    });
    await expect(removed).toContainText(`Ben Ito (ben@${DOMAIN})`);
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(page.getByText("Ada Park")).not.toHaveCount(0);
    await expect(page.getByRole("rowheader", { name: /Ben Ito/ })).toHaveCount(
      0
    );

    // A removed pre-approval takes its roster-added project with it.
    await page.getByRole("tab", { name: /Projects/ }).click();
    const added = page.getByRole("region", { name: "Added from the roster" });
    await expect(added).toContainText("Moon Base");
    await page.getByRole("tab", { name: /Bids/ }).click();
    await page
      .getByRole("button", { name: "Remove Kim Lee from placement" })
      .click();
    await expect(
      page.getByText(
        /2 students are removed from placement\. See the Roster tab/
      )
    ).toBeVisible();
    await page.getByRole("tab", { name: /Projects/ }).click();
    // The tab's own table first: a count of none passes before it renders.
    await expect(
      page.getByRole("cell", { name: "Tide Clock", exact: true })
    ).toBeVisible();
    await expect(added).toHaveCount(0);

    const parameters = page.getByRole("tab", { name: "Parameters" });
    await parameters.click();
    await expect(parameters).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Min students").fill("1");
    await page.getByRole("tab", { name: "Results" }).click();
    await page.getByRole("button", { name: "Run placement" }).click();
    await expect(placedFigure(page, "1 of 1")).toBeVisible({
      timeout: 20_000,
    });
    // On the board, Remove sits in the row's More menu and asks first, so
    // it is not read as "remove from this team" (#685).
    await expect(
      page.getByRole("button", { name: "Remove Ada Park from placement" })
    ).toHaveCount(0);
    const removeFromBoard = async () => {
      await page.getByRole("button", { name: "More for Ada Park" }).click();
      await page
        .getByRole("menuitem", { name: "Remove from placement..." })
        .click();
      return page.getByRole("alertdialog", {
        name: "Remove Ada Park from placement?",
      });
    };
    let dialog = await removeFromBoard();
    await expect(dialog).toContainText("not only this team");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(page.getByText(`ada@${DOMAIN}`)).toBeVisible();
    dialog = await removeFromBoard();
    await dialog.getByRole("button", { name: "Remove from placement" }).click();
    await expect(page.getByText(/moved or removed by hand/)).toBeVisible();
    await expect(page.getByText("Ada Park")).toHaveCount(0);
    // The figures drop her without a run (#701).
    await expect(placedFigure(page, "0 of 0")).toBeVisible();

    // New bids keep the removals, and with no bids the Roster tab still
    // lists them, named from the roster.
    await page.getByRole("tab", { name: /Bids/ }).click();
    await page.getByRole("button", { name: "Remove bids" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByRole("tab", { name: /Roster/ }).click();
    await expect(removed).toContainText("Kim Lee");
    await page.getByRole("tab", { name: /Bids/ }).click();
    await page.getByLabel("Bids CSV file").setInputFiles({
      name: "bids.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(BIDS_CSV),
    });
    await page.getByRole("tab", { name: /Roster/ }).click();
    await expect(removed).toContainText("3 students");
    await removed.getByRole("button", { name: "Restore Ben Ito" }).click();
    await expect(removed).toContainText("2 students");
    await page.getByRole("tab", { name: /Bids/ }).click();
    await expect(
      page.getByRole("rowheader", { name: /Ben Ito/ })
    ).toBeVisible();
  });

  test("clearing all data empties the stored workspace after a confirmation", async ({
    page,
  }) => {
    await page.goto("/admin/placement");
    await waitForHydration(page);
    await importFiles(page);
    await expect.poll(() => stored(page)).not.toBeNull();

    await page.getByRole("button", { name: "Clear all data" }).click();
    const dialog = page.getByRole("alertdialog", {
      name: "Clear all placement data?",
    });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("tab", { name: "Projects (0)" })).toBeVisible();
    await expect.poll(() => stored(page)).toBeNull();
  });
});
