# One Writer for the Project Transition Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fifty-six byte-identical lines shared by `performTransitionAs` and `forceTransitionAs` by moving everything after the gate behind one private `commitTransition`, so the three ordering rules become implementation rather than prose.

**Architecture:** Each public function keeps only its gate (who may act, which target is reachable) and delegates the rest. `commitTransition` owns the transaction, then the embedding refresh, then the email, then the return value. Because the force path has never been asserted to write history, notifications, or an embedding, its characterization tests land first and are what prove the extraction preserved behaviour.

**Spec:** `docs/superpowers/specs/2026-08-11-project-transition-writer-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, and docs.
- **No behavior change.** Same writes, same order, same errors, including the two gates' differing load-versus-authorize order: perform loads first and returns "Project not found", force authorizes first and returns "Forbidden".
- **No wire-format change, no migration, no new dependency.**
- **The nine `createServerFn` endpoints and both `*ForCurrentUser` wrappers are untouched.**
- **Test commands:** `ulimit -n 8192; CI=true npm test` / `npm run test:integration` (docker Postgres; it truncates, so `npm run db:seed:dev` afterwards if you want dev data back). Vitest needs the sandbox off in this environment.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Stage files by name. Never commit to `main`.** Branch `refactor/project-transition-writer` already exists and carries the spec commit.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/server/__tests__/projects.integration.test.ts` | characterization tests for the force path |
| `src/server/__tests__/project-embeddings.integration.test.ts` | the force path's embedding trigger |
| `src/server/_internal/projects.ts` | `commitTransition`, and both public functions reduced to their gates |
| `docs/QUIRKS.md` | the sole-writer invariant, scoped to what its grep proves |

---

## Phase 1: pin the force path before touching it

The extraction assumes the two bodies are equivalent. Nothing checks that today. These tests are the check, and they only count if they run against the current code.

- [ ] **Step 1: add the history and notification characterization test** to `src/server/__tests__/projects.integration.test.ts`, inside the `describe("project workflow")` block, after `"owner cannot publish"`. All the imports it needs are already at the top of that file.

```ts
  it("force writes the same history row and notification as a normal transition", async () => {
    // forceTransitionAs has never been asserted to do either. It shares a
    // body with performTransitionAs by copy, so this is what makes the
    // equivalence checkable rather than reviewable.
    const owner = await makeUser(`fo-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`fa-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    await forceTransitionAs(admin, id, "changes_requested", "force note");

    const [row] = await db.select().from(projects).where(eq(projects.id, id));
    expect(row.status).toBe("changes_requested");

    const history = await db
      .select()
      .from(projectStatusHistory)
      .where(eq(projectStatusHistory.projectId, id));
    expect(history).toHaveLength(1);
    expect(history[0].oldStatus).toBe("draft");
    expect(history[0].newStatus).toBe("changes_requested");
    expect(history[0].changedBy).toBe(admin.id);
    expect(history[0].comment).toBe("force note");

    const ownerNotifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, owner.id));
    expect(ownerNotifs).toHaveLength(1);
  });

  it("force sets publishedAt and archivedAt the same way", async () => {
    const owner = await makeUser(`fp-${Date.now()}@x.com`, "user");
    const admin = await makeUser(`fpa-${Date.now()}@x.com`, "admin");
    const { id } = await createProjectAs(owner, baseProject());

    await forceTransitionAs(admin, id, "published");
    const [published] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(published.publishedAt).not.toBeNull();

    await forceTransitionAs(admin, id, "archived");
    const [archived] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, id));
    expect(archived.archivedAt).not.toBeNull();
  });
```

- [ ] **Step 2: add the force path's embedding trigger test** to `src/server/__tests__/project-embeddings.integration.test.ts`, inside `describe("embedding triggers")`, after `"embeds when a project is published"`. Import `forceTransitionAs` alongside the existing `performTransitionAs` import.

```ts
  it("embeds when the force path publishes", async () => {
    const admin = await makeAdmin(`fg-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Forced"));
    const embed = vi.fn().mockResolvedValue(VECTOR);

    await forceTransitionAs(admin, id, "published", undefined, { embed });

    expect(embed).toHaveBeenCalledTimes(1);
    expect((await readRow(id)).embedding?.length).toBe(1024);
  });
```

- [ ] **Step 3: run them against the unchanged code.**

Run: `ulimit -n 8192; CI=true npm run test:integration`
Expected: PASS. **If any of the three fails, STOP.** That means the two bodies were never equivalent, which is a bug with its own commit and its own reasoning. Report it and do not continue into Phase 2. Do not adjust the assertion to match the behaviour.

- [ ] **Step 4: full gate.** `npm run check`, `npm run typecheck`.

- [ ] **Step 5: commit.**

```bash
git add src/server/__tests__/projects.integration.test.ts \
  src/server/__tests__/project-embeddings.integration.test.ts
git commit -m "test(projects): pin what the force transition path writes"
```

---

## Phase 2: extract `commitTransition`

- [ ] **Step 1: widen `assertChangesRequestedHasComment` to accept null.** At `src/server/_internal/projects.ts:208-217`, change the parameter from `comment?: string` to `comment: string | null`. The body already handles it: `!comment?.trim()` is true for `null`. This is what lets the seam take one comment type.

- [ ] **Step 2: add `commitTransition`** immediately after `assertChangesRequestedHasComment` and before `performTransitionAs`. The body is the current identical region, moved verbatim, with `comment ?? null` collapsed to `comment` and `viewer.id` replaced by `actorId`.

```ts
/**
 * Everything a status transition does once someone is allowed to make it.
 *
 * The two public transitions differ only in who may act and which targets are
 * reachable; both gates sit above this and neither is repeated here. The
 * ordering below is the reason this function exists rather than a comment:
 * notifications belong to the transaction, and the two remote calls must not.
 *
 * Takes `actorId` rather than a viewer on purpose. Authorization is settled
 * before this runs, so there is no role for it to consult.
 */
async function commitTransition(
  actorId: string,
  project: typeof projects.$inferSelect,
  target: Status,
  comment: string | null,
  opts?: TransitionOptions
): Promise<{ id: string; status: Status }> {
  assertChangesRequestedHasComment(target, comment);

  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = {
      status: target,
      updatedAt: new Date(),
    };
    if (target === "published" && !project.publishedAt) {
      updates.publishedAt = new Date();
    }
    if (target === "archived") {
      updates.archivedAt = new Date();
    }
    await tx.update(projects).set(updates).where(eq(projects.id, project.id));

    await tx.insert(projectStatusHistory).values({
      projectId: project.id,
      oldStatus: project.status,
      newStatus: target,
      changedBy: actorId,
      comment,
    });

    await recordStatusChangeNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      target,
      actorId,
      comment ?? undefined
    );
  });

  // After the transaction, never inside it: a Bedrock call must not hold a
  // database transaction open, and its failure must not roll back the publish.
  //
  // Inside the transaction this would not even fail loudly.
  // refreshProjectEmbedding re-reads the row and returns "skipped" unless the
  // status is already published, so a caller who got the order wrong would see
  // a project that publishes and never embeds.
  if (target === "published") {
    await refreshProjectEmbedding(project.id, opts?.embed);
  }

  // Same reasoning, and it matters more here: a failed email must not undo an
  // approval. notifyTransitionByEmail swallows its own errors.
  await notifyTransitionByEmail(
    {
      description: project.description,
      id: project.id,
      proposerEmail: project.proposerEmail,
      proposerId: project.proposerId,
      title: project.title,
    },
    target,
    comment,
    opts?.sendEmail ?? true,
    opts?.send
  );

  return { id: project.id, status: target };
}
```

Check `recordStatusChangeNotifications`'s fifth parameter type before committing to the `comment ?? undefined` above: if it already accepts `string | null`, pass `comment` directly and drop the coercion.

- [ ] **Step 3: reduce `performTransitionAs`** to its gate. Everything from `assertChangesRequestedHasComment` to the end of the function is replaced by one line. Note the load stays before the authorization check.

```ts
export async function performTransitionAs(
  viewer: AuthUser,
  id: string,
  target: Status,
  comment?: string,
  opts?: TransitionOptions
): Promise<{ id: string; status: Status }> {
  const visibility = viewerToVisibility(viewer);
  const project = await loadProjectOr404(id);
  if (!isStaff(visibility) && project.proposerId !== viewer.id) {
    throw new Error("Forbidden");
  }
  const role: ActorRole = isStaff(visibility) ? "staff" : "owner";
  assertTransitionAllowed(project.status as Status, target, role);
  return commitTransition(viewer.id, project, target, comment ?? null, opts);
}
```

- [ ] **Step 4: reduce `forceTransitionAs`** the same way. The authorization check stays before the load, so a non-staff caller naming a nonexistent id still gets "Forbidden" rather than "Project not found".

```ts
export async function forceTransitionAs(
  viewer: AuthUser,
  id: string,
  target: Status,
  comment?: string,
  opts?: TransitionOptions
): Promise<{ id: string; status: Status }> {
  const visibility = viewerToVisibility(viewer);
  if (!isStaff(visibility)) {
    throw new Error("Forbidden");
  }
  const project = await loadProjectOr404(id);
  if (project.status === target) {
    throw new Error("Project is already in that status.");
  }
  return commitTransition(viewer.id, project, target, comment ?? null, opts);
}
```

- [ ] **Step 5: confirm the duplication is gone.**

Run: `grep -c 'insert(projectStatusHistory)' src/server/_internal/projects.ts`
Expected: `1`

- [ ] **Step 6: full gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, then `npm run test:integration`. All green, including the three tests added in Phase 1. Those are the ones that matter here: they were written against the old code and must pass unchanged against the new.

- [ ] **Step 7: commit.**

```bash
git add src/server/_internal/projects.ts
git commit -m "refactor(projects): give the transition one writer"
```

---

## Phase 3: record the invariant

- [ ] **Step 1: add a `QUIRKS.md` entry** in the Projects section, after "Staff-only columns leak unless stripped in `stripPrivateFields`". Claim only what the check proves, and say what it does not cover:
  - `commitTransition` is the sole writer of `project_status_history`, checkable with `grep -rn 'insert(projectStatusHistory)' src --include='*.ts' | grep -v __tests__`, which returns one hit.
  - The wider claim "one writer of project status" would be false: `update(projects)` has six legitimate non-status writers (uploads, claim-projects, embeddings, soft delete, restore, `updateProjectAs`).
  - `softDeleteProjectAs` and `restoreProjectAs` write `deletedAt` and send notifications without writing history. They are outside this rule on purpose, because they are not transitions.
  - The three ordering rules, and specifically that a mid-transaction `refreshProjectEmbedding` returns `"skipped"` rather than throwing, so getting the order wrong produces a project that publishes and never embeds.
  - That `forceTransitionAs` had no coverage of its writes until this change, which is what a copied body costs.

- [ ] **Step 2: commit.**

```bash
git add docs/QUIRKS.md
git commit -m "docs(quirks): record the project transition writer"
```

---

## Phase 4: verify and open the PR

- [ ] **Step 1:** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build`, `npm run test:integration`. All green.
- [ ] **Step 2:** No UI change, so the accessibility suite is not required. Run it only if something surprising turns up.
- [ ] **Step 3:** Push, open the PR, wait for `verify` and `integration` to go green.

## Risks

| Risk | Mitigation |
| --- | --- |
| The two bodies were never equivalent | Phase 1 is exactly this check, and Step 3 says stop rather than adjust the assertion |
| The gate reduction changes an error precedence | Both gates are reproduced verbatim in Phase 2 Steps 3 and 4, load-versus-authorize order included; `"owner cannot publish"` and the `Forbidden` test cover them |
| `recordStatusChangeNotifications`'s comment parameter does not accept null | Phase 2 Step 2 says to check the signature and drop the coercion if it does |
| `project.status` is typed `string` and `oldStatus` expects it | Unchanged from today: the moved code already passes `project.status` straight through |
