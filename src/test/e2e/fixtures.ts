/**
 * Database fixtures for the end-to-end suite.
 *
 * Rows that a test mutates are created by the test itself, on every attempt,
 * rather than once in global setup. The inventory flow walks one item through
 * `available -> requested -> reserved -> checked_out -> available`, so a test
 * that fails at "Check out" leaves the item `reserved`. A retry starting from
 * that state fails differently and hides the original failure. Global setup
 * cannot help, because it already ran before the first attempt.
 *
 * Every row this module creates is named with `E2E_PREFIX`, which is also what
 * `sweepOrphans` deletes. That is the self-healing half: rows left behind by a
 * run that died mid-flow are removed at the start of the next one.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, like, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { OTHER_EMAIL } from "./constants";

export const E2E_PREFIX = "E2E-";

/**
 * The prefix on every account the suite signs up, which is a different problem
 * from the row prefix above. A fixed address fails at sign-up on the second run
 * because Better Auth rejects the duplicate, and a random one with no prefix
 * accumulates a user per run forever with nothing able to tell them apart.
 */
export const E2E_EMAIL_PREFIX = "e2e-";

/** An address for the account-lifecycle flow, swept by prefix like the rows. */
export function fixtureEmail(): string {
  return `${E2E_EMAIL_PREFIX}${randomUUID().slice(0, 8)}@example.com`;
}

export type Db = NodePgDatabase<typeof schema>;

/**
 * Callers are responsible for closing the pool. Tests open one per file rather
 * than sharing a module-level singleton, because Playwright runs each file in
 * its own worker process and a shared pool would leak a connection per worker.
 */
export function openDb(): { db: Db; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

/** A name no other run will collide with, swept by prefix on the next run. */
export function fixtureName(label: string): string {
  return `${E2E_PREFIX}${label}-${randomUUID().slice(0, 8)}`;
}

export async function createFixtureItem(
  db: Db,
  name: string
): Promise<{ id: string; name: string }> {
  const [item] = await db
    .insert(schema.inventoryItems)
    .values({
      name,
      description: "Created by the smoke suite. Safe to delete.",
    })
    .returning();
  return { id: item.id, name: item.name };
}

/** The seeded user rows the fixtures attribute things to. */
export async function userIdByEmail(db: Db, email: string): Promise<string> {
  const [row] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email));
  if (!row) {
    throw new Error(`${email} not found. Run: npm run db:seed:dev`);
  }
  return row.id;
}

/**
 * A project in whatever status the flow starts from.
 *
 * Built here rather than driven through `/projects/new` and the review UI,
 * unlike the smoke suite's, because these flows test what happens *from* a
 * status rather than the path into it. Walking the stepper to `published`
 * through the browser first would make an archive test that fails at step one
 * of six look like an archive bug.
 */
export async function createFixtureProject(
  db: Db,
  input: { title: string; proposerId: string; status?: string }
): Promise<{ id: string; title: string }> {
  const [project] = await db
    .insert(schema.projects)
    .values({
      title: input.title,
      description: "Created by the end-to-end suite. Safe to delete.",
      proposerId: input.proposerId,
      status: (input.status ?? "draft") as "draft",
      publishedAt: input.status === "published" ? new Date() : null,
    })
    .returning();
  return { id: project.id, title: project.title };
}

/**
 * A request line on an item, in a chosen state.
 *
 * The line and the item are written together on purpose: the read paths derive
 * what a student sees from *both* (`inventory-deadlines.ts` reads the item's
 * status and the line's dates), so a fixture that sets one without the other
 * produces a page no real transition could have produced.
 */
export async function createFixtureRequestLine(
  db: Db,
  input: {
    itemId: string;
    userId: string;
    lineStatus?: "pending" | "approved";
    itemStatus?: "requested" | "reserved" | "checked_out";
    dueAt?: Date | null;
  }
): Promise<{ lineId: string; requestId: string }> {
  const [request] = await db
    .insert(schema.inventoryRequests)
    .values({ userId: input.userId, note: "End-to-end suite fixture." })
    .returning();

  const [line] = await db
    .insert(schema.inventoryRequestItems)
    .values({
      requestId: request.id,
      itemId: input.itemId,
      status: input.lineStatus ?? "pending",
      dueAt: input.dueAt ?? null,
    })
    .returning();

  await db
    .update(schema.inventoryItems)
    .set({
      status: (input.itemStatus ?? "requested") as "requested",
      currentRequestItemId: line.id,
      currentHolderId: input.userId,
      currentDueAt: input.dueAt ?? null,
    })
    .where(eq(schema.inventoryItems.id, input.itemId));

  return { lineId: line.id, requestId: request.id };
}

/**
 * A staff-assigned hold with no request line behind it, which is the arm of
 * `DeadlineEntry` the walk-in and overdue flows exercise. `currentDueAt` in the
 * past is what makes it overdue: overdue is derived at read time, never stored,
 * so there is no flag to set instead.
 */
export async function giveFixtureHold(
  db: Db,
  input: {
    itemId: string;
    holderId: string;
    holderEmail: string;
    status?: "reserved" | "checked_out";
    dueAt?: Date | null;
    pickupBy?: Date | null;
  }
): Promise<void> {
  await db
    .update(schema.inventoryItems)
    .set({
      status: (input.status ?? "checked_out") as "checked_out",
      currentHolderId: input.holderId,
      currentHolderEmail: input.holderEmail,
      currentDueAt: input.dueAt ?? null,
      currentPickupBy: input.pickupBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.inventoryItems.id, input.itemId));
}

/** A date offset from now, for a deadline a flow needs on one side of it. */
export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/** The same date in the `YYYY-MM-DD` shape a date input expects. */
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Deletes every `E2E-` row left behind by an earlier run.
 *
 * Order matters. `inventory_request_items.item_id` is the one FK in this graph
 * declared `onDelete: "restrict"`; every other reference to an item cascades.
 * So the request lines (and the requests holding them) have to go before the
 * items do, or the item delete is refused.
 *
 * Four things beyond the rows themselves, each of which outlives its row:
 *
 * Notifications carry no FK to the item or project they are about, so deleting
 * those leaves the messages behind. They are matched on the prefix inside the
 * title, which every notification builder in `inventory-notifications.ts`
 * embeds because it names the thing. This is not housekeeping: unswept
 * notifications make the bell render an unread badge that the accessibility
 * suite then scans and fails on, which `docs/QUIRKS.md` records as the cause of
 * a red a11y run after a smoke run.
 *
 * Accounts, because the account-lifecycle flow signs one up. Sessions and
 * accounts cascade from `user`; `verification` has no FK at all and is keyed by
 * the address, so it is deleted by the same prefix. A flow that dies after
 * sign-up but before its assertions is the only way these survive, and the
 * `restrict` FKs out of `user` mean a leftover account that had gone on to
 * propose something would refuse to delete. That is deliberate: a loud failure
 * here beats silently deleting a row some other suite was reading.
 *
 * The avatar column on the second seeded user, because the avatar flow writes
 * to a *seeded* row rather than a fixture one. Nothing else in this repo clears
 * it, and an account left wearing an end-to-end avatar is a difference between
 * two runs of the accessibility suite.
 *
 * What is deliberately not swept: the objects those avatars and project images
 * put in the bucket. They are a few kilobytes of webp per run under keys
 * nothing lists, and a sweep would have to reach into storage from a module
 * whose entire job is the database.
 */
export async function sweepOrphans(db: Db): Promise<void> {
  const staleItems = await db
    .select({ id: schema.inventoryItems.id })
    .from(schema.inventoryItems)
    .where(like(schema.inventoryItems.name, `${E2E_PREFIX}%`));

  if (staleItems.length > 0) {
    const itemIds = staleItems.map((i) => i.id);
    const lines = await db
      .select({ requestId: schema.inventoryRequestItems.requestId })
      .from(schema.inventoryRequestItems)
      .where(inArray(schema.inventoryRequestItems.itemId, itemIds));

    const requestIds = [...new Set(lines.map((l) => l.requestId))];
    if (requestIds.length > 0) {
      // Deleting the request cascades to its lines, including lines for items
      // this sweep is not touching. That is correct: a request created by the
      // suite belongs entirely to the suite.
      await db
        .delete(schema.inventoryRequests)
        .where(inArray(schema.inventoryRequests.id, requestIds));
    }

    await db
      .delete(schema.inventoryItems)
      .where(inArray(schema.inventoryItems.id, itemIds));
  }

  await db
    .delete(schema.projects)
    .where(like(schema.projects.title, `${E2E_PREFIX}%`));

  await db
    .delete(schema.notifications)
    .where(like(schema.notifications.title, `%${E2E_PREFIX}%`));

  await db
    .delete(schema.verification)
    .where(like(schema.verification.identifier, `%${E2E_EMAIL_PREFIX}%`));

  await db
    .delete(schema.user)
    .where(like(schema.user.email, `${E2E_EMAIL_PREFIX}%`));

  await db
    .update(schema.user)
    .set({ image: null })
    .where(
      or(
        eq(schema.user.email, OTHER_EMAIL),
        eq(schema.user.email, "user@example.com")
      )
    );
}
