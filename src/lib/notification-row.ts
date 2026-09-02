/**
 * The five columns every notification insert in the app builds by hand.
 *
 * Declared structurally rather than from `typeof notifications.$inferInsert`,
 * which would carry `id`, `read` and `createdAt` and pull Drizzle into the
 * client-safe modules that decide these rows.
 *
 * It lives here rather than in either domain's decision module because both
 * `inventory-notifications.ts` and `project-notifications.ts` return it, and a
 * project module importing an inventory one to borrow a type is the coupling
 * `isStaff` moving to `viewer.ts` already argued against. Consumers import it
 * from here directly; Biome's `noBarrelFile` rejects a re-export.
 */
export interface NotificationRow {
  link: string;
  message: string;
  title: string;
  type: string;
  userId: string;
}
