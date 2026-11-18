import type { EmbedFn } from "#/lib/_internal/bedrock-embed";
import type { ResponsesFn } from "#/lib/_internal/bedrock-mantle";
import { redactQueryError } from "#/lib/_internal/redact-query-error";
import { categorizeProject } from "./project-categorize";
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
 * outcomes, and each writer records its own as the project's last attempt
 * for the staff panel (ADR-0060).
 */
export function refreshProjectInBackground(
  projectId: string,
  deps: RefreshDeps = {}
): void {
  const queuedAt = Date.now();
  enqueue(projectId, "refresh", () => refreshAndLog(projectId, deps, queuedAt));
}

/**
 * How many of a batch's refreshes run at once (#889). Each is two Bedrock
 * calls, so publishing 40 approved projects unbounded would start about 80 at
 * once and could throttle the staff panels' own refreshes. Exported for the
 * test that proves the bound.
 */
export const BATCH_REFRESH_CONCURRENCY = 4;

let batchSlotsInUse = 0;
const batchSlotWaiters: (() => void)[] = [];

async function withBatchSlot(work: () => Promise<void>): Promise<void> {
  if (batchSlotsInUse >= BATCH_REFRESH_CONCURRENCY) {
    await new Promise<void>((resolve) => batchSlotWaiters.push(resolve));
  } else {
    batchSlotsInUse++;
  }
  try {
    await work();
  } finally {
    // A waiter inherits the slot rather than the count dropping and rising,
    // so a refresh started outside a batch cannot slip between the two.
    const next = batchSlotWaiters.shift();
    if (next) {
      next();
    } else {
      batchSlotsInUse--;
    }
  }
}

/**
 * The refreshes a batch transition owes, started after its commit and not
 * awaited, at most `BATCH_REFRESH_CONCURRENCY` at a time across every batch
 * on this task (ADR-0070). Each is enqueued at once on its own project's
 * queue, so it still orders behind that project's earlier refresh and
 * `settleProjectRefreshes` covers it from the start; the slot is taken
 * inside the job, once its turn on that queue comes. A single save's refresh
 * takes no slot.
 */
export function refreshProjectsInBackground(
  projectIds: readonly string[],
  deps: RefreshDeps = {}
): void {
  const queuedAt = Date.now();
  for (const projectId of projectIds) {
    enqueue(projectId, "refresh", () =>
      withBatchSlot(() => refreshAndLog(projectId, deps, queuedAt))
    );
  }
}

/**
 * Starts the categorizer on a project just submitted, and returns without
 * waiting (#31): a proposer must never wait on a model, and a submission must
 * never fail because one did. On the same per-project queue as the refreshes,
 * so `settleProjectRefreshes` covers it. `categorizeProject` decides whether
 * there is anything to do, which there is only while the project carries no
 * categories, and records its own attempt and log line.
 */
export function categorizeProjectInBackground(
  projectId: string,
  categorize?: ResponsesFn
): void {
  enqueue(projectId, "categorization", async () => {
    await categorizeProject(projectId, categorize);
  });
}

/**
 * Chains `work` behind the project's previous background job. Every job
 * catches its own errors; this catch is for anything that slips past them,
 * since nobody awaits `run`. Nitro would log an unhandled rejection and carry
 * on, but a Vitest run fails on one, and this keeps the line redacted either
 * way.
 */
function enqueue(
  projectId: string,
  label: string,
  work: () => Promise<void>
): void {
  const previous = latestByProject.get(projectId) ?? Promise.resolve();
  const run = previous.then(work).catch((error: unknown) => {
    console.error(
      `Project ${label} failed for ${projectId}`,
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
  // line when either outcome is `failed`, by a regex anchored at its start.
  // Reword it and the alarm goes quiet; the test for this file runs the
  // filter's pattern against the line to catch that.
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
