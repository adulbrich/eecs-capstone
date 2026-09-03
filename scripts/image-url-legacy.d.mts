/**
 * Types for image-url-legacy.mjs, which is JavaScript because it runs from the
 * production container image and cannot import anything under src/. This file
 * exists so the integration test that drives it is typechecked.
 */

export interface LegacyImageUrl {
  table: "inventory_items" | "projects";
  id: string;
  imageUrl: string;
}

/** Anything that can run a parameterized query: a pg Pool or a pooled client. */
export interface Queryable {
  query(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

/** A pg Pool: `nullImageUrls` needs one connection for the whole transaction. */
export interface Connectable extends Queryable {
  connect(): Promise<Queryable & { release(): void }>;
}

export function findLegacyImageUrls(db: Queryable): Promise<LegacyImageUrl[]>;

export function nullImageUrls(
  pool: Connectable,
  ids: readonly string[]
): Promise<{ nulled: LegacyImageUrl[]; refused: string[] }>;
