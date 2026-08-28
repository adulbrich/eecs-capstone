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
  "admin.ts:getAdminStats": {
    level: "staff",
    note: "Gated inline in the handler, not in an _internal seam.",
  },

  "bookmarks.ts:addBookmark": {
    level: "authenticated",
    note: "Also runs canSeeProject on the target, so a guessed draft id cannot be bookmarked.",
  },
  "bookmarks.ts:isBookmarked": { level: "authenticated" },
  "bookmarks.ts:listMyBookmarks": {
    level: "authenticated",
    note: "Scoped to the viewer's own rows. Visibility is re-checked on read (#106).",
  },
  "bookmarks.ts:removeBookmark": {
    level: "authenticated",
    note: "Scoped to the viewer, so the id alone cannot remove someone else's.",
  },

  "categories.ts:createCategory": { level: "staff" },
  "categories.ts:deleteCategory": { level: "staff" },
  "categories.ts:getCategory": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "categories.ts:listCategories": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "categories.ts:listCategoriesWithUsage": { level: "staff" },
  "categories.ts:listCategoryTypes": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "categories.ts:listProjectCategories": {
    level: "public",
    note: "Takes a project id and returns that project's category names without checking canSeeProject, so an unpublished draft's categories are readable by anyone holding the id. Low severity and possibly intended; #113 decides whether to gate it.",
  },
  "categories.ts:setProjectCategories": {
    level: "staff",
    note: "assertStaff, then canSeeProject on the target project.",
  },
  "categories.ts:updateCategory": { level: "staff" },

  "comments.ts:addComment": {
    level: "owner-or-staff",
    note: "An internal comment additionally requires staff: a proposer cannot post one.",
  },

  "interests.ts:getMyInterests": { level: "authenticated" },
  "interests.ts:saveMyInterests": { level: "authenticated" },

  "inventory.ts:addToCart": {
    level: "authenticated",
    note: "Any signed-in user may cart any available item. The catalog is public, so there is no per-item visibility rule to apply.",
  },
  "inventory.ts:approveRequestItem": { level: "staff" },
  "inventory.ts:cancelRequestItem": {
    level: "authenticated",
    note: "Requester only: the line's requesterId must equal the viewer. Staff cancel through transitionInventoryItem instead.",
  },
  "inventory.ts:createInventoryItem": { level: "staff" },
  "inventory.ts:getCart": { level: "authenticated" },
  "inventory.ts:getInventoryItem": {
    level: "public",
    note: "Anonymous callers get the public projection; staff get the staff one, from the same endpoint.",
  },
  "inventory.ts:getInventoryItemDetail": {
    level: "public",
    note: "Anonymous callers get the public projection; staff get the staff one, from the same endpoint.",
  },
  "inventory.ts:hardDeleteInventoryItem": { level: "staff" },
  "inventory.ts:listAdminInventory": {
    level: "staff",
    note: "The wrapper reads the session and passes null when there is none, so assertStaff rejects anonymous callers.",
  },
  "inventory.ts:listInventory": {
    level: "public",
    note: "Anonymous callers get the public projection; staff see more, from the same endpoint.",
  },
  "inventory.ts:listInventoryCategories": {
    level: "public",
    note: "Public catalog. No join to user.",
  },
  "inventory.ts:listInventoryRequests": { level: "staff" },
  "inventory.ts:listMyItems": {
    level: "authenticated",
    note: "Scoped to the viewer. Only a verified address may claim a hold.",
  },
  "inventory.ts:rejectRequestItem": { level: "staff" },
  "inventory.ts:removeFromCart": { level: "authenticated" },
  "inventory.ts:submitCart": { level: "authenticated" },
  "inventory.ts:transitionInventoryItem": {
    level: "staff",
    note: "The handler carries only requireUser(). assertStaff inside transitionItem is the entire staff gate, and the schema deliberately omits `authority` so a signed-in user cannot supply one. See the transitionSchema docblock.",
  },
  "inventory.ts:updateInventoryItem": { level: "staff" },
  "inventory.ts:uploadInventoryImage": { level: "staff" },

  "notifications.ts:listMyNotifications": { level: "authenticated" },
  "notifications.ts:markAllRead": { level: "authenticated" },
  "notifications.ts:markRead": { level: "authenticated" },
  "notifications.ts:unreadCount": { level: "authenticated" },

  "profile.ts:updateProfile": {
    level: "authenticated",
    note: "Writes the viewer's own row only; the id comes from the session, never from the input.",
  },

  "programs.ts:addProgramInstructor": { level: "staff" },
  "programs.ts:createProgram": { level: "staff" },
  "programs.ts:deleteProgram": { level: "staff" },
  "programs.ts:getProgram": {
    level: "staff",
    note: "Joins instructor accounts. Was unauthenticated until #103.",
  },
  "programs.ts:listEligibleInstructors": {
    level: "staff",
    note: "Returns instructor id, name, email and role. Was unauthenticated until #103.",
  },
  "programs.ts:listPrograms": {
    level: "public",
    note: "Course id, name and description only. No join to user, which is what separates it from getProgram.",
  },
  "programs.ts:removeProgramInstructor": { level: "staff" },
  "programs.ts:updateProgram": { level: "staff" },

  "project-review.ts:reviewProject": {
    level: "owner-or-staff",
    note: "canEditProject. Also accepts no project id at all, for the submission page reviewing a proposal with no row yet.",
  },

  "projects-queries.ts:exportAdminProjects": { level: "staff" },
  "projects-queries.ts:getProject": {
    level: "public",
    note: "canSeeProject decides, so a draft 404s for a stranger. Status history and staff fields are withheld separately.",
  },
  "projects-queries.ts:getProposerForEdit": { level: "staff" },
  "projects-queries.ts:listAdminProjects": { level: "staff" },
  "projects-queries.ts:listMyProjects": {
    level: "authenticated",
    note: "Scoped to the viewer's own proposals.",
  },
  "projects-queries.ts:listProjectComments": {
    level: "public",
    note: "canSeeProject gates the project, then filterCommentsForViewer withholds internal comments from the proposer and everything from a stranger.",
  },
  "projects-queries.ts:listProjectEditLog": { level: "staff" },

  "projects.ts:approveProject": {
    level: "staff",
    note: "The endpoint gate is owner-or-staff, but only staff may reach `approved` in the TRANSITIONS table in src/lib/project-workflow.ts, which is where this is enforced.",
  },
  "projects.ts:archiveProject": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "projects.ts:createProject": {
    level: "authenticated",
    note: "Any signed-in user may propose. Staff creating one get a wider set of writable fields.",
  },
  "projects.ts:forceSetProjectStatus": {
    level: "staff",
    note: "Bypasses the transition rules, so it is gated on staff directly rather than through the workflow table.",
  },
  "projects.ts:hardDeleteProject": { level: "owner-or-staff" },
  "projects.ts:performTransition": {
    level: "owner-or-staff",
    note: "The generic entry point. Which transitions each role may make is decided by TRANSITIONS in src/lib/project-workflow.ts.",
  },
  "projects.ts:publishProject": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "projects.ts:requestChanges": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "projects.ts:restoreArchived": {
    level: "staff",
    note: "Enforced by TRANSITIONS in src/lib/project-workflow.ts, not by the endpoint gate.",
  },
  "projects.ts:restoreProject": { level: "staff" },
  "projects.ts:returnToDraft": {
    level: "owner-or-staff",
    note: "submitted to draft is open to both roles in TRANSITIONS.",
  },
  "projects.ts:softDeleteProject": { level: "staff" },
  "projects.ts:submitProject": {
    level: "owner-or-staff",
    note: "draft or changes_requested to submitted is open to both roles in TRANSITIONS.",
  },
  "projects.ts:updateProject": { level: "owner-or-staff" },

  "search.ts:searchProjects": {
    level: "public",
    note: "The public listing. The viewer id only scopes the recommended sort, it decides nothing.",
  },

  "uploads.ts:clearAvatar": { level: "authenticated" },
  "uploads.ts:uploadAvatar": {
    level: "authenticated",
    note: "The storage key is derived from the session id, so a viewer can only overwrite their own avatar.",
  },
  "uploads.ts:uploadProjectImage": { level: "owner-or-staff" },

  "users.ts:banUser": { level: "admin" },
  "users.ts:exportMentors": { level: "staff" },
  "users.ts:exportUsers": {
    level: "admin",
    note: "Every user column except authentication material: nothing from account or session is joined.",
  },
  "users.ts:getUser": { level: "admin" },
  "users.ts:listMentors": { level: "staff" },
  "users.ts:listUsers": {
    level: "admin",
    note: "/admin/users requires role === admin exactly, unlike every other admin route.",
  },
  "users.ts:lookupUserByEmail": { level: "staff" },
  "users.ts:searchUsers": { level: "staff" },
  "users.ts:setUserMentorStatus": { level: "staff" },
  "users.ts:setUserRole": { level: "admin" },
  "users.ts:unbanUser": { level: "admin" },
};
