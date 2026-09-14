import { PROJECT_STATUS_LABEL } from "./project-workflow";
import { PROJECT_STATUSES, type ProjectStatus } from "./vocabularies";

/**
 * The status set and the date range on `/admin/projects` (#335), as pure
 * functions so the trigger label and the last-item guard are unit-testable
 * without a menu.
 *
 * The default set is every status but `archived`. After the legacy import
 * archived rows are the bulk of the table and the ones nobody is working
 * on, so the default view is bounded by status rather than by a date.
 */
export const DEFAULT_ADMIN_STATUSES: readonly ProjectStatus[] =
  PROJECT_STATUSES.filter((s) => s !== "archived");

/**
 * The timestamp a From and To pair narrows on.
 *
 * `archived` is here because "what did we retire last summer" is a question
 * staff ask about the archive, and without it the only way to ask was a range
 * on `updated`, which answers something else.
 */
export const ADMIN_DATE_FIELDS = [
  "created",
  "published",
  "updated",
  "archived",
] as const;
export type AdminDateField = (typeof ADMIN_DATE_FIELDS)[number];
export const ADMIN_DATE_FIELD_LABEL: Record<AdminDateField, string> = {
  created: "Created",
  published: "Published",
  updated: "Updated",
  archived: "Archived",
};

/**
 * `created` and `updated` are `notNull` on `projects`; `published` and
 * `archived` are not, so a range on either silently drops every row with no
 * value. That was a rare edge case when a null meant "a draft, never
 * published". The legacy import makes it the common case: 302 of the 547
 * imported rows have no publish date and 264 have no archive date, because
 * the old portal's event log only starts 2022-08-03. The listing counts those
 * rows and says so rather than returning a quietly incomplete answer.
 */
export const ADMIN_DATE_FIELDS_NULLABLE: readonly AdminDateField[] = [
  "published",
  "archived",
];

export function dateFieldIsNullable(field: AdminDateField): boolean {
  return ADMIN_DATE_FIELDS_NULLABLE.includes(field);
}

/** Set equality on statuses, order and repeats ignored. */
export function sameStatusSet(
  a: readonly ProjectStatus[],
  b: readonly ProjectStatus[]
): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((s) => right.has(s));
}

export function isDefaultStatusSelection(
  statuses: readonly ProjectStatus[]
): boolean {
  return sameStatusSet(statuses, DEFAULT_ADMIN_STATUSES);
}

/**
 * The selection with `status` flipped, in vocabulary order. Unchecking the
 * last checked status is refused, so the empty set never exists and there
 * is no empty state to explain.
 */
export function toggleStatus(
  statuses: readonly ProjectStatus[],
  status: ProjectStatus
): ProjectStatus[] {
  const current = new Set(statuses);
  if (current.has(status)) {
    if (current.size === 1) {
      return [...current];
    }
    current.delete(status);
  } else {
    current.add(status);
  }
  return PROJECT_STATUSES.filter((s) => current.has(s));
}

/**
 * What the status trigger reads: the default set by name, the whole
 * vocabulary by name, a single status by its label, otherwise a count.
 */
export function statusSelectionLabel(
  statuses: readonly ProjectStatus[]
): string {
  const chosen = new Set(statuses);
  if (isDefaultStatusSelection(statuses)) {
    return "All but archived";
  }
  if (chosen.size === PROJECT_STATUSES.length) {
    return "All statuses";
  }
  if (chosen.size === 1) {
    return PROJECT_STATUS_LABEL[[...chosen][0] as ProjectStatus];
  }
  return `${chosen.size} statuses`;
}
