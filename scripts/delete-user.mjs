/**
 * Purge a test account and its content from production.
 *
 * Deletes the account along with the projects and inventory requests it made.
 * It refuses whenever the account acted on records it does not own, because
 * that means the "test" account touched real data and a purge is the wrong
 * tool for it.
 *
 * A run without CONFIRM=DELETE reports and writes nothing. Run it once to read
 * the report, then again to act on it.
 *
 *   ... run-task ... --overrides '{"containerOverrides":[{
 *     "name":"app",
 *     "command":["node","scripts/delete-user.mjs"],
 *     "environment":[{"name":"TARGET_EMAIL","value":"test@example.edu"}]
 *   }]}'
 *
 * Uses nothing but the production `pg` dependency, like promote-admin.mjs: the
 * container image carries the built server, not TypeScript, so nothing under
 * src/ is importable here.
 */
import pg from "pg";

/**
 * Conditions that make a purge the wrong operation. Each counts rows the
 * account is responsible for on records it does not own; "their project" means
 * `proposer_id` is the target, and those projects are deleted outright, so
 * activity on them is not a blocker.
 *
 * `IS DISTINCT FROM` rather than `<>` throughout: `proposer_id` is nullable and
 * a null proposer is not the target.
 */
const BLOCKERS = [
  {
    relation: "project_comments",
    reason: "comments on projects they did not propose",
    sql: `SELECT count(*)::int AS count
            FROM project_comments c
            JOIN projects p ON p.id = c.project_id
           WHERE c.author_id = $1
             AND p.proposer_id IS DISTINCT FROM $1`,
  },
  {
    relation: "project_status_history",
    reason: "status changes on projects they did not propose",
    sql: `SELECT count(*)::int AS count
            FROM project_status_history h
            JOIN projects p ON p.id = h.project_id
           WHERE h.changed_by = $1
             AND p.proposer_id IS DISTINCT FROM $1`,
  },
  {
    relation: "project_edit_log",
    reason: "edits to projects they did not propose",
    sql: `SELECT count(*)::int AS count
            FROM project_edit_log e
            JOIN projects p ON p.id = e.project_id
           WHERE e.editor_id = $1
             AND p.proposer_id IS DISTINCT FROM $1`,
  },
  {
    // Inventory items are shared and never user-owned, so every row here is an
    // action on someone else's record. No ownership test to apply.
    //
    // All three references, not just changed_by. holder_id is ON DELETE SET
    // NULL and request_item_id nulls when this account's request lines go, so
    // those two would silently strip a real item's history rather than
    // erroring. A SET NULL edge is the one that needs an explicit guard.
    relation: "inventory_item_status_history",
    reason: "inventory item history naming them",
    sql: `SELECT count(*)::int AS count
            FROM inventory_item_status_history h
            LEFT JOIN inventory_request_items ri ON ri.id = h.request_item_id
            LEFT JOIN inventory_requests r ON r.id = ri.request_id
           WHERE h.changed_by = $1
              OR h.holder_id = $1
              OR r.user_id = $1`,
  },
  {
    // Also SET NULL, also silent. Their own request lines go with the request,
    // so only lines on someone else's request count.
    relation: "inventory_request_items",
    reason: "inventory requests they reviewed or closed",
    sql: `SELECT count(*)::int AS count
            FROM inventory_request_items ri
            JOIN inventory_requests r ON r.id = ri.request_id
           WHERE (ri.reviewed_by = $1 OR ri.closed_by = $1)
             AND r.user_id IS DISTINCT FROM $1`,
  },
  {
    relation: "inventory_item_edit_log",
    reason: "inventory item edits",
    sql: `SELECT count(*)::int AS count
            FROM inventory_item_edit_log
           WHERE editor_id = $1`,
  },
  {
    relation: "projects.program_manager_id",
    reason: "program manager on projects they did not propose",
    sql: `SELECT count(*)::int AS count
            FROM projects
           WHERE program_manager_id = $1
             AND proposer_id IS DISTINCT FROM $1`,
  },
  {
    // project_bids and project_assignments have no UI, so there is no way to
    // clean these up short of SQL. Refuse rather than delete rows the operator
    // cannot see.
    relation: "project_bids",
    reason: "project bids",
    sql: `SELECT count(*)::int AS count
            FROM project_bids b
            LEFT JOIN projects p ON p.id = b.project_id
           WHERE b.student_id = $1
              OR p.proposer_id = $1`,
  },
  {
    relation: "project_assignments",
    reason: "project assignments",
    sql: `SELECT count(*)::int AS count
            FROM project_assignments a
            LEFT JOIN projects p ON p.id = a.project_id
           WHERE a.student_id = $1
              OR a.assigned_by = $1
              OR p.proposer_id = $1`,
  },
  {
    // current_holder_id is ON DELETE SET NULL, so this would not error. It
    // would leave the item in `checked_out` with no holder, and nothing in the
    // app can return it from there. Have staff return it first.
    relation: "inventory_items.current_holder_id",
    reason: "inventory items currently held (return them first)",
    sql: `SELECT count(*)::int AS count
            FROM inventory_items
           WHERE current_holder_id = $1`,
  },
];

/**
 * Rows that disappear with the account, all by cascade. Reported so the dry run
 * says what "delete" costs rather than only what it is allowed to touch.
 */
const CASCADES = [
  { label: "bookmarks", sql: "SELECT count(*)::int AS count FROM project_bookmarks WHERE user_id = $1" },
  { label: "cart items", sql: "SELECT count(*)::int AS count FROM inventory_cart_items WHERE user_id = $1" },
  { label: "notifications", sql: "SELECT count(*)::int AS count FROM notifications WHERE user_id = $1" },
  { label: "collaborator rows", sql: "SELECT count(*)::int AS count FROM project_collaborators WHERE user_id = $1" },
  { label: "program instructor rows", sql: "SELECT count(*)::int AS count FROM program_instructors WHERE user_id = $1" },
  { label: "interest statements", sql: "SELECT count(*)::int AS count FROM user_interests WHERE user_id = $1" },
  { label: "sessions", sql: "SELECT count(*)::int AS count FROM session WHERE user_id = $1" },
  { label: "linked sign-in accounts", sql: 'SELECT count(*)::int AS count FROM account WHERE user_id = $1' },
  { label: "inventory requests", sql: "SELECT count(*)::int AS count FROM inventory_requests WHERE user_id = $1" },
];

async function countRows(db, sql, id) {
  const result = await db.query(sql, [id]);
  return result.rows[0].count;
}

/**
 * The account at exactly this address, matched case-insensitively. Addresses
 * are unique, so at most one row comes back.
 */
export async function findUser(db, email) {
  const result = await db.query(
    `SELECT id, email, name, role, created_at
       FROM "user"
      WHERE lower(email) = lower($1)`,
    [email.trim()]
  );
  return result.rows[0] ?? null;
}

/**
 * What deleting this account would do, and what stops it. Writes nothing.
 *
 * Every field is always present, with `user` null when no account matches, so
 * a caller never has to branch before asking what is blocking.
 */
export async function inspectUser(db, email, options = {}) {
  const user = await findUser(db, email);
  if (!user) {
    return { user: null, blockers: [], projects: [], cascades: [] };
  }

  const blockers = [];
  if (user.role === "admin" && options.allowAdmin !== true) {
    blockers.push({
      relation: "user.role",
      reason: "account is an admin (set ALLOW_ADMIN=1 to override)",
      count: 1,
    });
  }
  for (const blocker of BLOCKERS) {
    const count = await countRows(db, blocker.sql, user.id);
    if (count > 0) {
      blockers.push({ relation: blocker.relation, reason: blocker.reason, count });
    }
  }

  const projects = await db.query(
    `SELECT id, title, status
       FROM projects
      WHERE proposer_id = $1
      ORDER BY created_at`,
    [user.id]
  );

  const cascades = [];
  for (const cascade of CASCADES) {
    const count = await countRows(db, cascade.sql, user.id);
    if (count > 0) {
      cascades.push({ label: cascade.label, count });
    }
  }

  return { user, blockers, projects: projects.rows, cascades };
}

/**
 * Delete the account and its own content, or refuse and say why.
 *
 * `pool` must be a pg.Pool: the inspection and the deletes share one connection
 * inside one transaction, so nothing can slip in between the check and the act.
 *
 * Order matters. Projects first, because deleting one cascades its comments,
 * status history, and edit log, which are otherwise RESTRICT against the user
 * row. Then inventory requests, which cascade their request items. The user row
 * last, which cascades everything in CASCADES.
 */
export async function purgeUser(pool, email, options = {}) {
  const dryRun = options.dryRun === true;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const report = await inspectUser(client, email, options);
    const stop = report.user === null || report.blockers.length > 0 || dryRun;
    if (stop) {
      await client.query("ROLLBACK");
      return { ...report, email, found: report.user !== null, deleted: false, dryRun };
    }

    await client.query("DELETE FROM projects WHERE proposer_id = $1", [report.user.id]);
    await client.query("DELETE FROM inventory_requests WHERE user_id = $1", [report.user.id]);
    await client.query('DELETE FROM "user" WHERE id = $1', [report.user.id]);
    await client.query("COMMIT");
    return { ...report, email, found: true, deleted: true, dryRun };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function formatReport(result) {
  const lines = [];
  if (!result.found) {
    lines.push(`${result.email}: no account with this address`);
    return lines.join("\n");
  }

  const { user } = result;
  lines.push(`${user.email} (${user.name}, role ${user.role}, joined ${user.created_at.toISOString().slice(0, 10)})`);

  if (result.blockers.length > 0) {
    lines.push("  BLOCKED. This account acted on records it does not own:");
    for (const blocker of result.blockers) {
      lines.push(`    ${blocker.count} ${blocker.reason} [${blocker.relation}]`);
    }
    lines.push("  Clear these through the app, then run again.");
    return lines.join("\n");
  }

  if (result.projects.length === 0) {
    lines.push("  Projects: none");
  } else {
    lines.push(`  Projects (${result.projects.length}, deleted with the account):`);
    for (const project of result.projects) {
      lines.push(`    ${project.title} [${project.status}]`);
    }
  }
  if (result.cascades.length > 0) {
    lines.push(`  Also removed: ${result.cascades.map((c) => `${c.count} ${c.label}`).join(", ")}`);
  }
  lines.push(result.deleted ? "  DELETED." : "  Would delete. Re-run with CONFIRM=DELETE to act on this.");
  return lines.join("\n");
}

async function main() {
  const raw = process.env.TARGET_EMAIL ?? process.argv[2];
  if (!raw) {
    throw new Error("TARGET_EMAIL (or first CLI argument) is required");
  }
  const emails = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (emails.length === 0) {
    throw new Error("TARGET_EMAIL contained no addresses");
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const dryRun = process.env.CONFIRM !== "DELETE";
  const allowAdmin = process.env.ALLOW_ADMIN === "1";
  console.log(dryRun ? "DRY RUN. Nothing will be written." : "CONFIRM=DELETE. Deleting.");

  const pool = new pg.Pool({ connectionString });
  let failed = false;
  try {
    for (const email of emails) {
      const result = await purgeUser(pool, email, { allowAdmin, dryRun });
      console.log(formatReport(result));
      if (!result.found || result.blockers.length > 0) {
        failed = true;
      }
    }
  } finally {
    await pool.end();
  }

  if (failed) {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
