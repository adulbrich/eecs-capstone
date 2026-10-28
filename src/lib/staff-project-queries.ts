import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { useState } from "react";

/**
 * The staff panel's reads on `/projects/$projectId`, keyed under one prefix
 * per project so a slow answer for one project lands in its own entry and
 * never on the next (#767). The sections and the panel share these builders,
 * since a section's save refreshes the edit log the panel reads.
 */
export const staffProjectKeys = {
  all: (projectId: string) => ["staff-project", projectId] as const,
  categories: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "categories"] as const,
  editLog: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "edit-log"] as const,
  mentorship: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "mentorship"] as const,
  programs: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "programs"] as const,
  proposer: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "proposer"] as const,
  scope: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "scope"] as const,
  similarity: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "similarity"] as const,
  socialSummary: (projectId: string) =>
    [...staffProjectKeys.all(projectId), "social-summary"] as const,
};

/**
 * For a query that fills a draft: nothing refetches under it, and the cache
 * dies with the panel, so every mount reads a fresh record as the effects did.
 * A cached copy kept for the default five minutes would seed a revisit's draft
 * from values a colleague has since replaced (docs/QUIRKS.md, "A query that
 * fills a draft never refetches on its own").
 */
export const DRAFT_QUERY_OPTIONS = {
  gcTime: 0,
  refetchOnWindowFocus: false,
  staleTime: Number.POSITIVE_INFINITY,
} as const;

/**
 * A staff read, with a redirect turned into an ordinary failure. Every staff
 * read refuses with one once the session ends, and a redirect thrown from a
 * `queryFn` navigates the tab. An empty answer, which is what the borrow list
 * returns, would read here as a blank record and enable a Save over it, so
 * the section reports a failed load instead.
 */
export async function staffRead<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isRedirect(error)) {
      throw new Error("Your session has ended. Reload the page to sign in.", {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * After a section's own save: refetch its record and the edit log, and hand
 * back the record only if the refetch landed. A failed refetch keeps the old
 * data beside the error, and reseeding the draft from that would show the
 * values from before the save.
 */
export async function refetchAfterSave<T>(
  queryClient: QueryClient,
  projectId: string,
  queryKey: QueryKey
): Promise<T | undefined> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey }),
    queryClient.invalidateQueries({
      queryKey: staffProjectKeys.editLog(projectId),
    }),
  ]);
  const state = queryClient.getQueryState<T>(queryKey);
  return state?.status === "success" ? state.data : undefined;
}

/**
 * Seeds a draft from a query's data when it first arrives for `projectId`,
 * and on no later change of that data: only the section's own save reseeds
 * it, so nothing replaces what staff are typing. The seed runs during render
 * rather than in an effect, so no frame enables Save beside a blank draft.
 */
export function useSeedOnArrival<T>(
  projectId: string,
  data: T | undefined,
  seed: (data: T) => void
): void {
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (data !== undefined && seededFor !== projectId) {
    setSeededFor(projectId);
    seed(data);
  }
}
