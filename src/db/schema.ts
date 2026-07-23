import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// biome-ignore lint/performance/noBarrelFile: single schema surface for drizzle and better-auth
export * from "./auth-schema";

/**
 * Read-only tsvector column. Populated by Postgres via GENERATED ALWAYS AS
 * (see migration 0002). Never write to it from TS. To change the weight
 * expression, drop the column and re-add it in a new migration.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

// Enums
export const projectStatusEnum = pgEnum("project_status", [
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "published",
  "archived",
]);

export const programs = pgTable("programs", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: text("course_id").notNull(),
  courseName: text("course_name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const programInstructors = pgTable(
  "program_instructors",
  {
    programId: uuid("program_id")
      .references(() => programs.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.programId, t.userId] })]
);

export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(), // 'project_type', 'technology', 'industry', 'field'
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    problemStatement: text("problem_statement"),
    objectives: text("objectives"),
    minQualifications: text("min_qualifications"),
    prefQualifications: text("pref_qualifications"),
    url: text("url"),
    contactEmail: text("contact_email"),
    contactName: text("contact_name"),
    imageUrl: text("image_url"),
    licenseRestrictions: text("license_restrictions"),
    teamsSupported: integer("teams_supported").notNull().default(1),
    /** Staff-visible only; never returned in public queries. */
    notes: text("notes"),

    proposerId: text("proposer_id").references(() => user.id, {
      onDelete: "set null",
    }),
    proposerEmail: text("proposer_email"),
    programId: uuid("program_id").references(() => programs.id, {
      onDelete: "set null",
    }),
    programManagerId: text("program_manager_id").references(() => user.id, {
      onDelete: "restrict",
    }),

    status: projectStatusEnum("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(problem_statement, '')), 'B') || setweight(to_tsvector('english', coalesce(objectives, '')), 'C') || setweight(to_tsvector('english', coalesce(min_qualifications, '')), 'C') || setweight(to_tsvector('english', coalesce(pref_qualifications, '')), 'C')`
      ),
    /**
     * Semantic embedding of the project's text, written only while the
     * project is published. Null means "not embedded yet" and must never be
     * treated as "no match": such rows sort last, they are not filtered out.
     */
    embedding: vector("embedding", { dimensions: 1024 }),
    embeddingSourceHash: text("embedding_source_hash"),
    embeddingUpdatedAt: timestamp("embedding_updated_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("projects_status_idx").on(t.status),
    index("projects_deleted_at_idx").on(t.deletedAt),
    index("projects_proposer_id_idx").on(t.proposerId),
    index("projects_proposer_email_idx").on(t.proposerEmail),
    index("projects_program_id_idx").on(t.programId),
    index("projects_published_at_idx").on(t.publishedAt),
    index("projects_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops")
    ),
  ]
);

/**
 * A user's own interest statement and its embedding.
 *
 * Deliberately not columns on `user`: that table is regenerated by the Better
 * Auth CLI into auth-schema.ts, only `additionalFields` survive regeneration,
 * and Better Auth has no vector type.
 */
export const userInterests = pgTable("user_interests", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  interestsText: text("interests_text").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }),
  embeddingSourceHash: text("embedding_source_hash"),
  embeddingUpdatedAt: timestamp("embedding_updated_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectCategories = pgTable(
  "project_categories",
  {
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    categoryId: uuid("category_id")
      .references(() => categories.id, { onDelete: "cascade" })
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.categoryId] })]
);

export const projectCollaborators = pgTable(
  "project_collaborators",
  {
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    role: text("role").default("collaborator"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })]
);

export const projectComments = pgTable(
  "project_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    authorId: text("author_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    parentId: uuid("parent_id").references(
      (): import("drizzle-orm/pg-core").AnyPgColumn => projectComments.id,
      { onDelete: "cascade" }
    ),
    content: text("content").notNull(),
    isInternal: boolean("is_internal").default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("project_comments_project_idx").on(t.projectId, t.createdAt)]
);

export const projectStatusHistory = pgTable(
  "project_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    oldStatus: projectStatusEnum("old_status"),
    newStatus: projectStatusEnum("new_status").notNull(),
    changedBy: text("changed_by")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("project_status_history_project_idx").on(t.projectId, t.createdAt),
  ]
);

export const projectBids = pgTable("project_bids", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id)
    .notNull(),
  studentId: text("student_id")
    .references(() => user.id, { onDelete: "restrict" })
    .notNull(),
  programId: uuid("program_id")
    .references(() => programs.id)
    .notNull(),
  motivation: text("motivation").notNull(),
  qualifications: text("qualifications"),
  rank: integer("rank").notNull(), // 1-5 preference
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectAssignments = pgTable("project_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id")
    .references(() => projects.id)
    .notNull(),
  studentId: text("student_id")
    .references(() => user.id, { onDelete: "restrict" })
    .notNull(),
  assignedBy: text("assigned_by")
    .references(() => user.id, { onDelete: "restrict" })
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const projectBookmarks = pgTable(
  "project_bookmarks",
  {
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })]
);

// INVENTORY
export const inventoryItemStatusEnum = pgEnum("inventory_item_status", [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
  "retired",
]);

export const inventoryRequestItemStatusEnum = pgEnum(
  "inventory_request_item_status",
  ["pending", "approved", "rejected", "cancelled", "returned"]
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category"),
    serial: text("serial"),
    location: text("location"),
    notes: text("notes"),
    imageUrl: text("image_url"),

    status: inventoryItemStatusEnum("status").notNull().default("available"),
    currentHolderId: text("current_holder_id").references(() => user.id, {
      onDelete: "set null",
    }),
    currentHolderLabel: text("current_holder_label"),
    currentRequestItemId: uuid("current_request_item_id"),

    searchVector: tsvector("search_vector")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(category, '')), 'C')`
      ),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_items_status_idx").on(t.status),
    index("inventory_items_category_idx").on(t.category),
    index("inventory_items_current_holder_idx").on(t.currentHolderId),
  ]
);

export const inventoryRequests = pgTable(
  "inventory_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_requests_user_created_idx").on(t.userId, t.createdAt),
  ]
);

export const inventoryRequestItems = pgTable(
  "inventory_request_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .references(() => inventoryRequests.id, { onDelete: "cascade" })
      .notNull(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "restrict" })
      .notNull(),

    status: inventoryRequestItemStatusEnum("status")
      .notNull()
      .default("pending"),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewComment: text("review_comment"),

    pickupBy: timestamp("pickup_by", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),

    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedBy: text("closed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    closedReason: text("closed_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_request_items_request_idx").on(t.requestId),
    index("inventory_request_items_item_idx").on(t.itemId),
    index("inventory_request_items_status_idx").on(t.status),
  ]
);

export const inventoryCartItems = pgTable(
  "inventory_cart_items",
  {
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);

export const inventoryItemStatusHistory = pgTable(
  "inventory_item_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    oldStatus: inventoryItemStatusEnum("old_status"),
    newStatus: inventoryItemStatusEnum("new_status").notNull(),
    changedBy: text("changed_by")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    comment: text("comment"),
    requestItemId: uuid("request_item_id").references(
      () => inventoryRequestItems.id,
      { onDelete: "set null" }
    ),
    holderId: text("holder_id").references(() => user.id, {
      onDelete: "set null",
    }),
    holderLabel: text("holder_label"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("inventory_item_status_history_item_idx").on(t.itemId, t.createdAt),
  ]
);

export const inventoryItemEditLog = pgTable(
  "inventory_item_edit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .references(() => inventoryItems.id, { onDelete: "cascade" })
      .notNull(),
    editorId: text("editor_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    changedFields: text("changed_fields").array().notNull(),
    oldValues: jsonb("old_values").notNull(),
    newValues: jsonb("new_values").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("inventory_item_edit_log_item_idx").on(t.itemId, t.createdAt)]
);

// NOTIFICATIONS
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    link: text("link"),
    read: boolean("read").default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("notifications_user_read_created_idx").on(
      t.userId,
      t.read,
      t.createdAt
    ),
  ]
);

export const projectEditLog = pgTable(
  "project_edit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .references(() => projects.id, { onDelete: "cascade" })
      .notNull(),
    editorId: text("editor_id")
      .references(() => user.id, { onDelete: "restrict" })
      .notNull(),
    changedFields: text("changed_fields").array().notNull(),
    oldValues: jsonb("old_values").notNull(),
    newValues: jsonb("new_values").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("project_edit_log_project_idx").on(t.projectId, t.createdAt)]
);
