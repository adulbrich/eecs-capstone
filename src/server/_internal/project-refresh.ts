import type { EmbedFn } from "#/lib/_internal/bedrock-embed";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import { refreshProjectEmbedding } from "./project-embeddings";
import { refreshSocialSummary } from "./project-social-summary";

export interface RefreshDeps {
  embed?: EmbedFn;
  summarize?: ResponsesFn;
}

const inFlight = new Set<Promise<void>>();
const latestByProject = new Map<string, Promise<void>>();

/**
 * Starts a project's embedding and social summary refresh and returns without
 * waiting for either. The save or publish that calls this has committed, and
 * its response must not wait on Bedrock: a stalled Mantle call once held a
 * save for 301 s with the row already written (ADR-0053).
 *
 * Refreshes for one project run one after another, in the order they are
 * started just after each commit, and each reads the row when it runs, so the
 * last one reads the last committed text. Each logs one line with both
 * outcomes, which is the only record that a refresh applied.
 */
export function refreshProjectInBackground(
  projectId: string,
  deps: RefreshDeps = {}
): void {
  const queuedAt = Date.now();
  const previous = latestByProject.get(projectId) ?? Promise.resolve();
  // Both refreshes catch their own errors; this catch is for anything that
  // slips past them, since nobody awaits `run`. Nitro would log an unhandled
  // rejection and carry on, but a Vitest run fails on one, and this keeps the
  // line redacted either way.
  const run = previous
    .then(() => refreshAndLog(projectId, deps, queuedAt))
    .catch((error: unknown) => {
      console.error(
        `Project refresh failed for ${projectId}`,
        redactQueryError(error)
      );
    });
  latestByProject.set(projectId, run);
  inFlight.add(run);
  run.finally(() => {
    inFlight.delete(run);
    if (latestByProject.get(projectId) === run) {
      latestByProject.delete(projectId);
    }
  });
}

/**
 * Two calls, not one, because the two are separate models with separate kill
 * switches: an embeddings outage must not cost the project its preview text,
 * and the reverse. The duration runs from the commit, so it includes any wait
 * behind this project's previous refresh.
 */
async function refreshAndLog(
  projectId: string,
  deps: RefreshDeps,
  queuedAt: number
) {
  const embedding = await refreshProjectEmbedding(projectId, deps.embed);
  const summary = await refreshSocialSummary(projectId, deps.summarize);
  // The `ai_write_failures` metric filter in `infra/alarms.tf` counts this
  // line when either outcome is `failed`, by the lowercase phrases around
  // each outcome. Reword it and the alarm goes quiet; the test for this file
  // runs the filter's pattern against the line to catch that.
  console.log(
    `Project refresh for ${projectId}: embedding ${embedding}, social summary ${summary}, ${Date.now() - queuedAt} ms`
  );
}

/**
 * Resolves once every refresh started so far, and any started while waiting,
 * has finished. For tests, which read the row a refresh writes.
 */
export async function settleProjectRefreshes(): Promise<void> {
  while (inFlight.size > 0) {
    await Promise.allSettled([...inFlight]);
  }
}
