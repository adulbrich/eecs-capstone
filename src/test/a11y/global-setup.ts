import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FullConfig } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { and, eq, inArray, like, notInArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { normalizeEmailAddress } from "../../lib/email-address";
import { SEED_PASSWORD, saveStorageState } from "../shared/playwright";

// Prefixes used by the create-dialog-plus-dropdown coverage in
// admin.a11y.test.ts. Those rows are deleted by the test itself on success,
// but a failed assertion partway through would otherwise leave one behind
// forever. Sweeping by prefix here makes a failed run self-heal on the next
// one, the same role the rest of this file's select-first fixtures play.
const DIALOG_CATEGORY_NAME_PREFIX = "A11y Dialog Category ";
const DIALOG_PROGRAM_COURSE_ID_PREFIX = "A11Y-DLG-";
// Extra users so /admin/users has more than one page of real rows (pageSize
// is 20). The dev seed alone never clears that bar, and the pagination-reset
// assertion in admin.a11y.test.ts needs an actual second page to sort from,
// not just a page=2 URL with nothing behind it.
const PAGINATION_USER_COUNT = 15;
// One project per parallel slot; see createBookmarkProjects at the bottom.
const BOOKMARK_PROJECT_TITLE_PREFIX = "A11Y Bookmark Project (slot ";

function bookmarkProjectTitle(slot: number): string {
  return `${BOOKMARK_PROJECT_TITLE_PREFIX}${slot})`;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = "http://localhost:3000";

export default async function globalSetup(config: FullConfig) {
  loadDotenv({ path: [".env.local", ".env"] });

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema });

  // Read off the resolved config rather than written down here, so the pool
  // tracks whatever `--workers` the run actually uses.
  const workerCount = config.workers;

  try {
    await createFixtures(db, workerCount);
  } finally {
    await pool.end();
  }

  await Promise.all([
    saveStorageState({
      baseURL: BASE_URL,
      email: "user@example.com",
      password: SEED_PASSWORD,
      outputPath: join(__dirname, ".user-auth.json"),
    }),
    saveStorageState({
      baseURL: BASE_URL,
      email: "admin@example.com",
      password: SEED_PASSWORD,
      outputPath: join(__dirname, ".admin-auth.json"),
    }),
  ]);
}

async function createFixtures(
  db: NodePgDatabase<typeof schema>,
  workerCount: number
) {
  const [owner] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, "user@example.com"));
  if (!owner) {
    throw new Error(
      "user@example.com not found in database. Run: npm run db:seed:dev"
    );
  }

  const [instructor] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, "instructor@example.com"));
  if (!instructor) {
    throw new Error(
      "instructor@example.com not found in database. Run: npm run db:seed:dev"
    );
  }
  // instructor is a DB fixture only, never a session: a row in
  // program_instructors, and the proposer of the bookmark pool below.

  const [adminUser] = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, "admin@example.com"));
  if (!adminUser) {
    throw new Error(
      "admin@example.com not found in database. Run: npm run db:seed:dev"
    );
  }
  if (adminUser.role !== "admin") {
    throw new Error(
      `admin@example.com has role '${adminUser.role}', expected 'admin'. Run: npm run db:seed:dev`
    );
  }

  // Opt the owner user into mentoring so /admin/mentors renders a populated
  // row (Input + Save/Remove buttons) for axe to scan, not just the empty
  // state, and give them a LinkedIn address so the admin user detail renders
  // that link in body copy for the underline assertion.
  await db
    .update(schema.user)
    .set({
      linkedin: "https://www.linkedin.com/in/a11y-owner",
      mentorTeamCount: 2,
      wantsToMentor: true,
    })
    .where(eq(schema.user.id, owner.id));

  // Self-heal any row left behind by a create-dialog test that failed after
  // creating but before its own cleanup ran.
  await db
    .delete(schema.categories)
    .where(like(schema.categories.name, `${DIALOG_CATEGORY_NAME_PREFIX}%`));
  await db
    .delete(schema.programs)
    .where(
      like(schema.programs.courseId, `${DIALOG_PROGRAM_COURSE_ID_PREFIX}%`)
    );

  // Idempotent, select-first, same pattern as the rest of this function.
  // Explicit, spread-out createdAt values matter here: userOrderBy's
  // `createdAt DESC` has no tiebreaker, and rows sharing the same
  // defaultNow() timestamp would make LIMIT/OFFSET pagination unstable
  // across the two pages the sort-reset test depends on.
  for (let i = 0; i < PAGINATION_USER_COUNT; i++) {
    const email = `a11y-pagination-user-${i}@example.com`;
    const [existingPaginationUser] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, email));
    if (!existingPaginationUser) {
      await db.insert(schema.user).values({
        id: randomUUID(),
        name: `A11y Pagination User ${i}`,
        email,
        emailVerified: true,
        role: "user",
        createdAt: new Date(Date.now() - (i + 1) * 60_000),
      });
    }
  }

  // Note: select-first is non-atomic. Concurrent global-setup runs could produce
  // duplicate rows since these tables have no UNIQUE constraint on their sentinel
  // values. Acceptable for single-worker CI; revisit if workers > 1.

  // Category (no unique constraint on name, hence the select-first pattern)
  let [category] = await db
    .select()
    .from(schema.categories)
    .where(eq(schema.categories.name, "a11y-test-category"));
  if (!category) {
    [category] = await db
      .insert(schema.categories)
      .values({
        name: "a11y-test-category",
        domain: "project",
        type: "technology",
      })
      .returning();
  }

  // Program (no unique constraint on courseId, hence the select-first pattern)
  let [program] = await db
    .select()
    .from(schema.programs)
    .where(eq(schema.programs.courseId, "A11Y-101"));
  if (!program) {
    [program] = await db
      .insert(schema.programs)
      .values({
        courseId: "A11Y-101",
        courseName: "Accessibility Test Program",
      })
      .returning();
  }

  // Program instructor join (has composite PK, so onConflictDoNothing is safe)
  await db
    .insert(schema.programInstructors)
    .values({ programId: program.id, userId: instructor.id })
    .onConflictDoNothing();

  // Project (no unique constraint on title, hence the select-first pattern)
  // The detail scan asserts the contact address and the URL as links in
  // body copy, so the fixture carries both; `public.a11y.test.ts` names them.
  const A11Y_PROJECT_CONTACT = {
    contactEmail: "a11y-contact@example.com",
    contactName: "A11y Contact",
    url: "https://example.com/a11y-project",
  };
  let [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.title, "A11Y Test Project"));
  if (!project) {
    [project] = await db
      .insert(schema.projects)
      .values({
        title: "A11Y Test Project",
        description:
          "## Overview\n\nThis project was **created** for *accessibility testing* " +
          "of the markdown-authoring feature. See the [project charter]" +
          "(https://example.com/charter) for background.\n\n" +
          "Key aspects:\n\n" +
          "- Renders headings, lists, and links\n" +
          "- Exercises bold and italic emphasis\n" +
          "- Includes a fenced code block\n\n" +
          '```js\nconst status = "published";\n```',
        problemStatement:
          "# Problem Statement\n\n" +
          "Capstone teams currently **lack** a way to author *rich* project " +
          "descriptions. Without markdown support, students cannot:\n\n" +
          "1. Link to external references\n" +
          "2. Format code snippets\n" +
          "3. Structure long text with headings\n\n" +
          "See the [accessibility guidelines](https://example.com/a11y) for " +
          "more detail.\n\n```bash\nnpm run test:accessibility\n```",
        objectives:
          "## Objectives\n\n" +
          "The team will pursue the following *primary* and **secondary** goals:\n\n" +
          "1. Ship a markdown renderer that is accessible by default\n" +
          "2. Clamp author headings so page structure stays valid\n" +
          "3. Keep links [safe](https://example.com/safety) with proper `rel` attributes\n\n" +
          "- No raw HTML execution\n" +
          "- No layout regressions\n\n```ts\nexport const done = true;\n```",
        minQualifications:
          "## Minimum Qualifications\n\n" +
          "Team members should be comfortable with **TypeScript** and *React*, " +
          "and have reviewed the [contribution guide]" +
          "(https://example.com/contributing).\n\n" +
          "Required skills:\n\n" +
          "- Familiarity with accessible markup\n" +
          "- Experience writing automated tests\n\n" +
          "1. Complete the onboarding checklist\n" +
          "2. Set up the local dev environment\n\n```sh\nnpm install\n```",
        status: "published",
        proposerId: owner.id,
        ...A11Y_PROJECT_CONTACT,
      })
      .returning();
  } else if (!project.contactEmail) {
    // A row from before the contact fields existed: the detail scan reads
    // the address and the URL, so fill them in rather than fail on a stale
    // local fixture.
    [project] = await db
      .update(schema.projects)
      .set(A11Y_PROJECT_CONTACT)
      .where(eq(schema.projects.id, project.id))
      .returning();
  }

  // The project runs in the program, so the public detail scan has a badge
  // row to look at and the staff panel has a checked box (#462). Composite
  // PK, so onConflictDoNothing makes a re-run safe.
  await db
    .insert(schema.projectPrograms)
    .values({ projectId: project.id, programId: program.id })
    .onConflictDoNothing();

  // Inventory item (no unique constraint on name, hence the select-first pattern)
  let [item] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.name, "A11Y Test Item"));
  if (!item) {
    [item] = await db
      .insert(schema.inventoryItems)
      .values({
        name: "A11Y Test Item",
        description: "An item for accessibility testing.",
      })
      .returning();
  }

  // An item in the fixture user's borrow list, so the Borrow list tab scans
  // its assembled-request region rather than the empty state (#64). A second
  // item rather than the one above: the smoke flows walk that one through the
  // lifecycle and an item in a cart is not `available` to request twice.
  let [cartItem] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.name, "A11Y Cart Item"));
  if (!cartItem) {
    [cartItem] = await db
      .insert(schema.inventoryItems)
      .values({
        name: "A11Y Cart Item",
        description: "An item waiting in the fixture user's borrow list.",
      })
      .returning();
  }
  await db
    .insert(schema.inventoryCartItems)
    .values({ userId: owner.id, itemId: cartItem.id })
    .onConflictDoNothing();

  // An overdue hold on the fixture user, so the attention region on
  // /my/items is asserted against a fixture rather than the dev seed (#64).
  // Written directly, as the other fixtures are: it is a row to scan, not a
  // transition to exercise.
  let [overdueItem] = await db
    .select()
    .from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.name, "A11Y Overdue Item"));
  if (!overdueItem) {
    [overdueItem] = await db
      .insert(schema.inventoryItems)
      .values({
        name: "A11Y Overdue Item",
        description: "Checked out to the fixture user, past its due date.",
      })
      .returning();
  }
  await db
    .update(schema.inventoryItems)
    .set({
      status: "checked_out",
      currentHolderId: owner.id,
      currentDueAt: new Date(Date.now() - 2 * 86_400_000),
    })
    .where(eq(schema.inventoryItems.id, overdueItem.id));

  // A custom request for the fixture user: one line sourcing with a note and
  // one fulfilled with an item linked and reserved to them, so /my/items
  // scans a custom group with a hold nested under its line, and the queue
  // scans the second row kind. Written directly, as the other fixtures are;
  // select-first on the line name.
  const [existingCustom] = await db
    .select()
    .from(schema.inventoryCustomLines)
    .where(eq(schema.inventoryCustomLines.name, "A11Y Custom Line"));
  if (!existingCustom) {
    const [envelope] = await db
      .insert(schema.inventoryRequests)
      .values({ userId: owner.id, note: "For the accessibility scan." })
      .returning();
    await db.insert(schema.inventoryCustomLines).values({
      requestId: envelope.id,
      name: "A11Y Custom Line",
      reason: "A thing the inventory does not hold.",
      quantity: 2,
      status: "sourcing",
      sourcingNote: "Ordered, two weeks.",
      reviewedAt: new Date(),
    });
    let [produced] = await db
      .select()
      .from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.name, "A11Y Produced Item"));
    if (!produced) {
      [produced] = await db
        .insert(schema.inventoryItems)
        .values({
          name: "A11Y Produced Item",
          description: "Bought to fulfil the fixture user's custom line.",
        })
        .returning();
    }
    const [fulfilled] = await db
      .insert(schema.inventoryCustomLines)
      .values({
        requestId: envelope.id,
        name: "A11Y Fulfilled Line",
        reason: "Arrived and reserved.",
        quantity: 1,
        status: "fulfilled",
        outcomeNote: "On the shelf by the door.",
        reviewedAt: new Date(),
        closedAt: new Date(),
      })
      .returning();
    await db
      .insert(schema.inventoryCustomLineItems)
      .values({ customLineId: fulfilled.id, itemId: produced.id })
      .onConflictDoNothing();
    await db
      .update(schema.inventoryItems)
      .set({
        status: "reserved",
        currentHolderId: owner.id,
        currentPickupBy: new Date(Date.now() + 5 * 86_400_000),
      })
      .where(eq(schema.inventoryItems.id, produced.id));
  }

  // Draft project owned by the fixture user (no unique constraint on title,
  // select-first pattern). user.a11y.test.ts needs a draft it can sign in as
  // user@example.com and see a delete trigger on: the dev seed's only draft
  // (71203d97-6bfe-4580-a318-594522c1ef8e) is proposed by
  // riveras@oregonstate.edu, not the fixture owner, so OwnerProjectActions
  // never renders the delete confirmation dialog for that user.
  let [draftProject] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.title, "A11Y Test Draft Project"));
  if (!draftProject) {
    [draftProject] = await db
      .insert(schema.projects)
      .values({
        title: "A11Y Test Draft Project",
        description:
          "A draft project owned by the fixture user, used to " +
          "scan the delete confirmation dialog in its open and closed states.",
        status: "draft",
        proposerId: owner.id,
        proposerEmail: normalizeEmailAddress(owner.email),
      })
      .returning();
  }

  const bookmarkProjectIds = await createBookmarkProjects(
    db,
    owner,
    instructor,
    workerCount
  );

  writeFileSync(
    join(__dirname, ".fixtures.json"),
    JSON.stringify(
      {
        projectId: project.id,
        bookmarkProjectIds,
        draftProjectId: draftProject.id,
        itemId: item.id,
        categoryId: category.id,
        programId: program.id,
        userId: owner.id,
      },
      null,
      2
    )
  );
}

/**
 * One project per parallel slot, for the one scan in the suite that writes.
 *
 * Playwright's guarantee is that two tests running at the same time have
 * different `parallelIndex` values, between 0 and `workers - 1`. Nothing
 * weaker holds: a project id per browser project still has the three copies
 * of a `--repeat-each=3` run writing to one row, which is the very command
 * #435 asks to pass. So the pool is sized by the worker count and the test
 * picks its slot. Read-only scans keep sharing `projectId`; only the writer
 * needs a row of its own.
 *
 * Two things keep the pool out of everything else the suite scans, both of
 * which matter more the wider the machine is. It is archived, so the default
 * `/projects` listing excludes it and sixteen of these cannot push the public
 * catalog onto a second page and turn "projects list, paginated" in
 * `public.a11y.test.ts` red. And the proposer is the instructor rather than
 * the scanning student, because `/my/projects` lists a proposer's projects
 * unpaginated and across every status, so the pool would otherwise grow that
 * page's scan, and the fixture user's admin detail page with it.
 *
 * The bookmark paths do not care who proposed it: `canSeeProject` admits an
 * archived project for everyone, and `listMyBookmarksAs` counts it as
 * available rather than as one of the projects it had to drop.
 */
async function createBookmarkProjects(
  db: NodePgDatabase<typeof schema>,
  owner: typeof schema.user.$inferSelect,
  instructor: typeof schema.user.$inferSelect,
  workerCount: number
): Promise<string[]> {
  const bookmarkProjectIds: string[] = [];
  for (let slot = 0; slot < workerCount; slot++) {
    // No unique constraint on title, hence the select-first pattern the rest
    // of this file uses.
    const title = bookmarkProjectTitle(slot);
    let [bookmarkProject] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.title, title));
    if (!bookmarkProject) {
      [bookmarkProject] = await db
        .insert(schema.projects)
        .values({
          title,
          description:
            "An archived project the bookmark scan saves and removes. One " +
            "per parallel slot, so two scans running at the same time never " +
            "write to the same row.",
          status: "archived",
          archivedAt: new Date(),
          proposerId: instructor.id,
          proposerEmail: normalizeEmailAddress(instructor.email),
        })
        .returning();
    }
    bookmarkProjectIds.push(bookmarkProject.id);
  }

  // A narrower run leaves the slots it no longer uses behind, and select-first
  // never prunes, so the pool would only ever grow. Deleting takes their
  // bookmark rows with it through the FK.
  await db
    .delete(schema.projects)
    .where(
      and(
        like(schema.projects.title, `${BOOKMARK_PROJECT_TITLE_PREFIX}%`),
        notInArray(schema.projects.id, bookmarkProjectIds)
      )
    );

  // Start every run unbookmarked, the same self-healing role the dialog
  // sweep at the top of this file plays. The scan reads the toggle's label to
  // decide whether a crashed run left one saved, and that label is the
  // `useState(false)` first render until `isBookmarked` lands: read it a beat
  // early against a saved row and the click removes the bookmark instead of
  // saving it, and the wait that follows has nothing to wait for.
  await db
    .delete(schema.projectBookmarks)
    .where(
      and(
        eq(schema.projectBookmarks.userId, owner.id),
        inArray(schema.projectBookmarks.projectId, bookmarkProjectIds)
      )
    );

  return bookmarkProjectIds;
}
