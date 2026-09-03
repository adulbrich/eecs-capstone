/**
 * What every `createServerFn` endpoint is supposed to allow.
 *
 * There is no global middleware. Each endpoint is independently HTTP-reachable
 * and carries its own authorization or carries none, and the gate is spelled
 * three ways: `requireUser()` inside the impl, a file-local `getViewer()` or
 * `readSession()` delegating to an `*As(viewer, ...)` that decides, or
 * deliberately absent because the data is public catalog. Those three are
 * indistinguishable to a grep, which is how `getProgram` and
 * `listEligibleInstructors` returned every admin's and instructor's id, name,
 * email and role to anonymous callers for three months (#103, #108).
 *
 * So the level is declared here rather than detected from code shape.
 * `access-contract.test.ts` fails if a use of `createServerFn` cannot be
 * parsed, if an endpoint exists with no line, if a line names an endpoint that
 * does not exist, or if the set declared `public` changes.
 *
 * Adding an endpoint means adding its line. Answer what it should allow. Do
 * not copy the level of the entry above it.
 *
 * Two constraints the notes carry, because they are what the levels protect
 * rather than properties of the levels themselves:
 *
 * - `proposerEmail` is the private link key. It joins a project to an account
 *   that may not exist yet, so it is an address someone was invited by rather
 *   than one they published. Stripped from public reads; the endpoints that
 *   return it are staff or above.
 * - `contactEmail` is a separate, manually entered, publicly visible field.
 *
 * The two are easy to confuse and confusing them fails in one direction only,
 * so the notes name which is which wherever both are in play.
 */

export type AccessLevel =
  /** Reachable with no session at all. */
  | "public"
  /** Any signed-in user. The rows are scoped to that viewer. */
  | "authenticated"
  /** The project's proposer, or any staff member. */
  | "owner-or-staff"
  /** `assertStaff`, or an equivalent `isStaff` check. */
  | "staff"
  /** `assertAdmin`. Narrower than staff: `role === "admin"` exactly. */
  | "admin";

interface AccessDeclaration {
  level: AccessLevel;
  /**
   * Where the decision is actually made, when it is not the `*As` seam the
   * handler calls, and anything a reader would otherwise have to open the file
   * to learn.
   */
  note?: string;
}

/**
 * Shared because two endpoints return the same projection, and this file's one
 * proven failure mode is a note drifting from the code it describes. Two copies
 * of a claim this specific is two chances to correct only one of them.
 */
const PUBLIC_ITEM_VIEW_NOTE =
  "The projection branches on isStaff, not on having a session, so anonymous and signed-in non-staff callers get the same public view and only staff see more. publicItemView omits holder identity, serial, label, location and notes. getInventoryItemDetail withholds two things more: the staff branch returns the status history, joined to user.name, where the public branch returns an empty array, and a hasRequestHistory flag that exists only on the staff branch.";

export const ACCESS_CONTRACT: Record<string, AccessDeclaration> = {
  "server/account.ts:deleteAccount": {
    level: "authenticated",
    note: "Scoped to the session user and takes no id: a person can delete only their own account. Anonymizes the row in place and deletes only what a real DELETE would cascade; see _internal/account.ts. The admin-executed version is #29 and does not exist yet.",
  },
  "server/account.ts:getAccountDeletionPreview": {
    level: "authenticated",
    note: "Scoped to the session user. Returns the held items that block deletion and the programs it will remove the person from, for the dialog to say before it acts.",
  },
  "server/admin.ts:getAdminStats": {
    level: "staff",
    note: "Gated inline in the handler, not in an _internal seam.",
  },

  "server/bookmarks.ts:addBookmark": {
    level: "authenticated",
    note: "Also runs canSeeProject on the target, so a guessed draft id cannot be bookmarked.",
  },
  "server/bookmarks.ts:isBookmarked": { level: "authenticated" },
  "server/bookmarks.ts:listMyBookmarkIds": {
    level: "authenticated",
    note: "Scoped to the viewer. Returns project ids only, so the listing that renders a bookmark toggle per row makes one request instead of twenty.",
  },
  "server/bookmarks.ts:listMyBookmarks": {
    level: "authenticated",
    note: "Scoped to the viewer's own rows. Soft-deleted projects are dropped in SQL, and every remaining row is then filtered through canSeeProject, so the write-time gate cannot become a permanent capability. proposerId and deletedAt are selected for that check and dropped before the payload.",
  },
  "server/bookmarks.ts:removeBookmark": {
    level: "authenticated",
    note: "Scoped to the viewer, so the id alone cannot remove someone else's.",
  },

  "server/categories.ts:createCategory": { level: "staff" },
  "server/categories.ts:deleteCategory": { level: "staff" },
  "server/categories.ts:getCategory": {
    level: "public",
    note: "Public catalog. No join to user. Nothing projects that: getCategoryImpl is a bare select() returning every column, so a column added to `categories` would ride into a public read. categories.integration.test.ts pins the exact key set and is the only enforcement.",
  },
  "server/categories.ts:listCategories": {
    level: "public",
    note: "Public catalog. No join to user. Nothing projects that: listCategoriesImpl is a bare select() returning every column, so a column added to `categories` would ride into a public read. categories.integration.test.ts pins the exact key set and is the only enforcement.",
  },
  "server/categories.ts:listCategoriesWithUsage": { level: "staff" },
  "server/categories.ts:listCategoryTypes": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "server/categories.ts:listProjectCategories": {
    level: "public",
    note: "canSeeProject gates the project inside listProjectCategoriesAs, so a draft's category names reach staff and the proposer only; published and archived are public. Both callers load the project through a gated read first, so the guard refuses only a bare id.",
  },
  "server/categories.ts:setProjectCategories": {
    level: "staff",
    note: "assertStaff decides. The canSeeProject call after it cannot reject, because canSeeProject returns true for staff before it looks at anything else; the live second guard is the `if (!project)` above it. Do not read this as the checked-visibility shape addBookmark uses.",
  },
  "server/categories.ts:updateCategory": { level: "staff" },

  "server/comments.ts:addComment": {
    level: "owner-or-staff",
    note: "An internal comment additionally requires staff: a proposer cannot post one.",
  },

  "server/interests.ts:getMyInterests": { level: "authenticated" },
  "server/interests.ts:saveMyInterests": { level: "authenticated" },

  "server/inventory.ts:addToCart": {
    level: "authenticated",
    note: "Any signed-in user may cart any item, but addToCartAs throws unless item.status is available. That check is the per-item rule: a retired or otherwise non-available item is hidden from non-staff by canReadInventoryItem, and the status guard is what stops one being carted by id. Do not remove it as redundant with the public catalog.",
  },
  "server/inventory.ts:approveRequestItem": { level: "staff" },
  "server/inventory.ts:cancelRequestItem": {
    level: "authenticated",
    note: "Requester only: the line's requesterId must equal the viewer. Staff cancel through transitionInventoryItem instead.",
  },
  "server/inventory.ts:createInventoryItem": { level: "staff" },
  "server/inventory.ts:getCart": { level: "authenticated" },
  "server/inventory.ts:getInventoryItem": {
    level: "public",
    note: PUBLIC_ITEM_VIEW_NOTE,
  },
  "server/inventory.ts:getInventoryItemDetail": {
    level: "public",
    note: PUBLIC_ITEM_VIEW_NOTE,
  },
  "server/inventory.ts:hardDeleteInventoryItem": { level: "staff" },
  "server/inventory.ts:listAdminInventory": {
    level: "staff",
    note: "The wrapper reads the session and passes null when there is none, so assertStaff rejects anonymous callers.",
  },
  "server/inventory.ts:listInventory": {
    level: "public",
    note: PUBLIC_ITEM_VIEW_NOTE,
  },
  "server/inventory.ts:listInventoryCategories": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "server/inventory.ts:listInventoryItemEditLog": {
    level: "staff",
    note: "The item's edit log, staff by the same rule as listProjectEditLog: it names who edited the item and which fields they touched. Narrower than that one on purpose, selecting four columns rather than the row, because oldValues and newValues carry notes, serial and location and nothing renders them. Never on the public item page.",
  },
  "server/inventory.ts:listInventoryRequests": { level: "staff" },
  "server/inventory.ts:listMyItems": {
    level: "authenticated",
    note: "Scoped to the viewer. Only a verified address may claim a hold.",
  },
  "server/inventory.ts:rejectRequestItem": { level: "staff" },
  "server/inventory.ts:removeFromCart": { level: "authenticated" },
  "server/inventory.ts:submitCart": { level: "authenticated" },
  "server/inventory.ts:transitionInventoryItem": {
    level: "staff",
    note: "The handler carries only requireUser(). The staff gate is the assertStaff in assertAuthorized (src/lib/inventory-workflow.ts), reached through transitionItem and assertTransitionAllowed, and the schema deliberately omits `authority` so a signed-in user cannot supply one. See the transitionSchema docblock.",
  },
  "server/inventory.ts:updateInventoryItem": { level: "staff" },
  "server/inventory.ts:uploadInventoryImage": { level: "staff" },

  "server/notifications.ts:listMyNotifications": { level: "authenticated" },
  "server/notifications.ts:markAllRead": { level: "authenticated" },
  "server/notifications.ts:markRead": { level: "authenticated" },
  "server/notifications.ts:unreadCount": { level: "authenticated" },

  "server/profile.ts:updateProfile": {
    level: "authenticated",
    note: "Writes the viewer's own row only; the id comes from the session, never from the input.",
  },

  "server/programs.ts:addProgramInstructor": { level: "staff" },
  "server/programs.ts:createProgram": { level: "staff" },
  "server/programs.ts:deleteProgram": { level: "staff" },
  "server/programs.ts:getProgram": {
    level: "staff",
    note: "Joins instructor accounts. Was unauthenticated until #103.",
  },
  "server/programs.ts:listEligibleInstructors": {
    level: "staff",
    note: "Returns instructor id, name, email and role. Was unauthenticated until #103.",
  },
  "server/programs.ts:listPrograms": {
    level: "public",
    note: "Public because this does not join `user`, which is what separates it from getProgram, and because listProgramsImpl projects the six public columns by name: `term_count` is staff-only and stays out. programs.integration.test.ts pins the exact key set.",
  },
  "server/programs.ts:listProgramsWithInstructors": {
    level: "staff",
    note: "The admin index's read. Joins `user` for instructor names, which is what listPrograms must never do, so it is a separate endpoint gated like getProgram rather than a widening of the public one.",
  },
  "server/programs.ts:removeProgramInstructor": { level: "staff" },
  "server/scope-assessment.ts:assessProjectScope": {
    level: "staff",
    note: "A paid Bedrock call that writes the verdict onto the project. Staff only, and staff only: the assessment never reaches the proposer or the public payload, and it is metered under its own limit pair (#61).",
  },
  "server/scope-assessment.ts:getScopeAssessment": {
    level: "staff",
    note: "Reads the stored verdict and whether the project's text has moved since. The three columns are absent from projectDetailView, so this is the only way they leave the server.",
  },
  "server/programs.ts:updateProgram": { level: "staff" },

  "server/project-review.ts:reviewProject": {
    level: "authenticated",
    note: "Narrows to owner-or-staff only when a project id is supplied: reviewProjectAs runs canEditProject inside `if (input.projectId)`, and the id is optional because the submission page reviews a proposal with no row yet. With no id the gate is requireUser() plus assertReviewWithinLimit, which is what bounds spend on a paid endpoint now that ownership no longer does.",
  },

  "server/projects-queries.ts:exportAdminProjects": {
    level: "staff",
    note: "Reads adminProjectSummarySelect, which carries proposer identity and contactEmail, and then adds `notes` in its own select rather than through the shared one. `notes` is the staff-only field this gate exists for, and adding it here is what keeps it out of the listing that shares the projection.",
  },
  "server/projects-queries.ts:getProject": {
    level: "public",
    note: "canSeeProject decides, so a draft 404s for a stranger. Status history and staff fields are withheld separately. The projection carries contactEmail, which is manually entered and publicly visible by design, and must never carry proposerEmail.",
  },
  "server/projects-queries.ts:getProposerForEdit": {
    level: "staff",
    note: "The endpoint that exists to return proposerEmail, the private link key that joins a project to an account which may not exist yet. Staff only, and it must not widen: leaking it exposes the address a proposer was invited by, not one they chose to publish.",
  },
  "server/projects-queries.ts:getProjectMentorship": {
    level: "staff",
    note: "Returns mentorEmail, an address staff typed rather than one the person published. The public payload carries only the resolved name and the seeking flag.",
  },
  "server/projects-queries.ts:listAdminProjects": {
    level: "staff",
    note: "Reads adminProjectSummarySelect, so it carries proposerEmail and contactEmail both. Staff is what keeps the first out of a public read.",
  },
  "server/projects-queries.ts:listMyProjects": {
    level: "authenticated",
    note: "Scoped to the viewer's own proposals.",
  },
  "server/projects-queries.ts:listProjectComments": {
    level: "public",
    note: "canSeeProject gates the project, then filterCommentsForViewer withholds internal comments from the proposer and everything from a stranger.",
  },
  "server/projects-queries.ts:listProjectEditLog": {
    level: "staff",
    note: "Gated by an inline getViewer() plus isStaff inside listProjectEditLogImpl, which the handler calls directly. One of the seven endpoints #108 found a guard-name grep could not see.",
  },

  "server/projects.ts:approveProject": {
    level: "staff",
    note: "The endpoint gate is owner-or-staff, but only staff may reach `approved` in the TRANSITIONS table in src/lib/project-workflow.ts, which is where this is enforced.",
  },
  "server/projects.ts:archiveProject": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "server/projects.ts:createProject": {
    level: "authenticated",
    note: "Any signed-in user may propose. Staff creating one get a wider set of writable fields.",
  },
  "server/projects.ts:forceSetProjectStatus": {
    level: "staff",
    note: "Bypasses the transition rules, so it is gated on staff directly rather than through the workflow table.",
  },
  "server/projects.ts:hardDeleteProject": { level: "owner-or-staff" },
  "server/projects.ts:performTransition": {
    level: "owner-or-staff",
    note: "The generic entry point. Which transitions each role may make is decided by TRANSITIONS in src/lib/project-workflow.ts.",
  },
  "server/projects.ts:publishProject": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "server/projects.ts:requestChanges": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "server/projects.ts:restoreArchived": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "server/projects.ts:restoreProject": { level: "staff" },
  "server/projects.ts:returnToDraft": {
    level: "owner-or-staff",
    note: "submitted to draft is open to both roles in TRANSITIONS.",
  },
  "server/projects.ts:softDeleteProject": { level: "staff" },
  "server/projects.ts:submitProject": {
    level: "owner-or-staff",
    note: "draft or changes_requested to submitted is open to both roles in TRANSITIONS.",
  },
  "server/projects.ts:updateProject": { level: "owner-or-staff" },
  "server/projects.ts:updateProjectMentorship": {
    level: "staff",
    note: "The only writer of studentProposed and mentorEmail. Neither key exists on ProjectInput, so updateProject cannot reach them; this endpoint is what keeps the pair staff-only.",
  },

  "server/search.ts:searchProjects": {
    level: "public",
    note: "The public listing. The viewer id only scopes the recommended sort, it decides nothing.",
  },

  "server/uploads.ts:clearAvatar": { level: "authenticated" },
  "server/uploads.ts:uploadAvatar": {
    level: "authenticated",
    note: "The storage key puts the user id off the resolved session in the path, under avatars, so a viewer can only overwrite their own avatar. Not the session id: those are different values.",
  },
  "server/uploads.ts:uploadProjectImage": { level: "owner-or-staff" },

  "server/users.ts:banUser": { level: "admin" },
  "server/users.ts:exportMentors": { level: "staff" },
  "server/users.ts:exportUsers": {
    level: "admin",
    note: "Every user column except authentication material: nothing from account or session is joined.",
  },
  "server/users.ts:getUser": {
    level: "admin",
    note: "Gated in getUserForCurrentUser, not in getUserImpl, which is exported ungated and selects the whole user row rather than naming columns. That is the shape #103 shipped in, and the widest projection in this file.",
  },
  "server/users.ts:listMentors": { level: "staff" },
  "server/users.ts:listUsers": {
    level: "admin",
    note: "Gated in listUsersForCurrentUser, not in listUsersImpl, which is exported and ungated. The /admin/users routes require role === admin exactly, where most admin routes accept staff.",
  },
  "server/users.ts:lookupUserByEmail": { level: "staff" },
  "server/users.ts:searchUsers": { level: "staff" },
  "server/users.ts:setUserMentorStatus": { level: "staff" },
  "server/users.ts:setUserRole": { level: "admin" },
  "server/users.ts:unbanUser": { level: "admin" },

  // Not under src/server. It is still an independently reachable endpoint, and
  // leaving it out is how the count came to 86 when it was 87.
  "lib/auth-guards.ts:getSession": {
    level: "public",
    note: "Returns the caller's own session, or null when there is none. Public because asking who you are cannot leak someone else: the answer is derived from the request's own cookies.",
  },
};
