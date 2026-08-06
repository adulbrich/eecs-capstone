/**
 * The `categories.type` value that marks a category as belonging to inventory
 * rather than to projects.
 *
 * Inventory categories live in the same table as the project category types
 * (project_type, technology, industry, field) but are a different domain: the
 * project pickers exclude this type, and the inventory form selects only it.
 * Single source of the string so a typo cannot silently create a second,
 * invisible domain.
 */
export const INVENTORY_CATEGORY_TYPE = "inventory" as const;
