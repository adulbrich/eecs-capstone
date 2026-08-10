/**
 * Types for delete-user.mjs, which is JavaScript because it runs from the
 * production container image and cannot import anything under src/. This file
 * exists so the integration test that drives it is typechecked.
 */

/** Columns pulled from `user`. Snake case: these come straight from `pg`. */
export interface DeleteUserAccount {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: Date;
}

export interface DeleteUserBlocker {
  /** Table, or `table.column` where the table alone would be ambiguous. */
  relation: string;
  reason: string;
  count: number;
}

export interface DeleteUserProject {
  id: string;
  title: string;
  status: string;
}

export interface DeleteUserCascade {
  label: string;
  count: number;
}

/** Every field is always present; `user` is null when no account matched. */
export interface DeleteUserReport {
  user: DeleteUserAccount | null;
  blockers: DeleteUserBlocker[];
  projects: DeleteUserProject[];
  cascades: DeleteUserCascade[];
}

export interface DeleteUserResult extends DeleteUserReport {
  email: string;
  found: boolean;
  deleted: boolean;
  dryRun: boolean;
}

export interface DeleteUserOptions {
  /** Permit an account whose role is `admin`. Default false. */
  allowAdmin?: boolean;
  /** Report only, roll back before writing. Default false. */
  dryRun?: boolean;
}

/** Anything that can run a parameterized query: a pg Pool or a pooled client. */
export interface Queryable {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A pg Pool: `purgeUser` needs one connection for the whole transaction. */
export interface Connectable extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

export function findUser(
  db: Queryable,
  email: string
): Promise<DeleteUserAccount | null>;

export function inspectUser(
  db: Queryable,
  email: string,
  options?: DeleteUserOptions
): Promise<DeleteUserReport>;

export function purgeUser(
  pool: Connectable,
  email: string,
  options?: DeleteUserOptions
): Promise<DeleteUserResult>;
