import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";

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

async function importFiles(page: Page) {
  await page.getByLabel("Projects CSV file").setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(PROJECTS_CSV),
  });
  await expect(page.getByRole("cell", { name: "Tide Clock" })).toBeVisible();
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
