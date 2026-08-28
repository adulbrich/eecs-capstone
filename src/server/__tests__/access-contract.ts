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
 * So the level is declared here rather than detected from code shape, and
 * `access-contract.test.ts` fails if an endpoint exists with no line or a line
 * names an endpoint that does not exist.
 *
 * Adding an endpoint means adding its line. Answer what it should allow. Do
 * not copy the level of the entry above it.
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

export const ACCESS_CONTRACT: Record<string, AccessDeclaration> = {
  "server/admin.ts:getAdminStats": {
    level: "staff",
    note: "Gated inline in the handler, not in an _internal seam.",
  },

  "server/bookmarks.ts:addBookmark": {
    level: "authenticated",
    note: "Also runs canSeeProject on the target, so a guessed draft id cannot be bookmarked.",
  },
  "server/bookmarks.ts:isBookmarked": { level: "authenticated" },
  "server/bookmarks.ts:listMyBookmarks": {
    level: "authenticated",
    note: "Scoped to the viewer's own rows. Visibility is re-checked on read (#106).",
  },
  "server/bookmarks.ts:removeBookmark": {
    level: "authenticated",
    note: "Scoped to the viewer, so the id alone cannot remove someone else's.",
  },

  "server/categories.ts:createCategory": { level: "staff" },
  "server/categories.ts:deleteCategory": { level: "staff" },
  "server/categories.ts:getCategory": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "server/categories.ts:listCategories": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "server/categories.ts:listCategoriesWithUsage": { level: "staff" },
  "server/categories.ts:listCategoryTypes": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "server/categories.ts:listProjectCategories": {
    level: "public",
    note: "Takes a project id and returns that project's category names without checking canSeeProject, so an unpublished draft's categories are readable by anyone holding the id. Low severity and possibly intended; #113 decides whether to gate it.",
  },
  "server/categories.ts:setProjectCategories": {
    level: "staff",
    note: "assertStaff, then canSeeProject on the target project.",
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
    note: "Any signed-in user may cart any available item. The catalog is public, so there is no per-item visibility rule to apply.",
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
    note: "Anonymous callers get the public projection; staff get the staff one, from the same endpoint.",
  },
  "server/inventory.ts:getInventoryItemDetail": {
    level: "public",
    note: "Anonymous callers get the public projection; staff get the staff one, from the same endpoint.",
  },
  "server/inventory.ts:hardDeleteInventoryItem": { level: "staff" },
  "server/inventory.ts:listAdminInventory": {
    level: "staff",
    note: "The wrapper reads the session and passes null when there is none, so assertStaff rejects anonymous callers.",
  },
  "server/inventory.ts:listInventory": {
    level: "public",
    note: "Anonymous callers get the public projection; staff see more, from the same endpoint.",
  },
  "server/inventory.ts:listInventoryCategories": {
    level: "public",
    note: "Public catalog. No join to user.",
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
    note: "The handler carries only requireUser(). The staff gate is the assertStaff in assertTransitionAllowed (src/lib/inventory-workflow.ts), reached through transitionItem, and the schema deliberately omits `authority` so a signed-in user cannot supply one. See the transitionSchema docblock.",
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
    note: "Course id, name and description only. No join to user, which is what separates it from getProgram.",
  },
  "server/programs.ts:removeProgramInstructor": { level: "staff" },
  "server/programs.ts:updateProgram": { level: "staff" },

  "server/project-review.ts:reviewProject": {
    level: "authenticated",
    note: "Narrows to owner-or-staff only when a project id is supplied: reviewProjectAs runs canEditProject inside `if (input.projectId)`, and the id is optional because the submission page reviews a proposal with no row yet. With no id the gate is requireUser() plus assertReviewWithinLimit, which is what bounds spend on a paid endpoint now that ownership no longer does.",
  },

  "server/projects-queries.ts:exportAdminProjects": { level: "staff" },
  "server/projects-queries.ts:getProject": {
    level: "public",
    note: "canSeeProject decides, so a draft 404s for a stranger. Status history and staff fields are withheld separately.",
  },
  "server/projects-queries.ts:getProposerForEdit": { level: "staff" },
  "server/projects-queries.ts:listAdminProjects": { level: "staff" },
  "server/projects-queries.ts:listMyProjects": {
    level: "authenticated",
    note: "Scoped to the viewer's own proposals.",
  },
  "server/projects-queries.ts:listProjectComments": {
    level: "public",
    note: "canSeeProject gates the project, then filterCommentsForViewer withholds internal comments from the proposer and everything from a stranger.",
  },
  "server/projects-queries.ts:listProjectEditLog": { level: "staff" },

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

  "server/search.ts:searchProjects": {
    level: "public",
    note: "The public listing. The viewer id only scopes the recommended sort, it decides nothing.",
  },

  "server/uploads.ts:clearAvatar": { level: "authenticated" },
  "server/uploads.ts:uploadAvatar": {
    level: "authenticated",
    note: "The storage key is derived from the session id, so a viewer can only overwrite their own avatar.",
  },
  "server/uploads.ts:uploadProjectImage": { level: "owner-or-staff" },

  "server/users.ts:banUser": { level: "admin" },
  "server/users.ts:exportMentors": { level: "staff" },
  "server/users.ts:exportUsers": {
    level: "admin",
    note: "Every user column except authentication material: nothing from account or session is joined.",
  },
  "server/users.ts:getUser": { level: "admin" },
  "server/users.ts:listMentors": { level: "staff" },
  "server/users.ts:listUsers": {
    level: "admin",
    note: "/admin/users requires role === admin exactly, unlike every other admin route.",
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
