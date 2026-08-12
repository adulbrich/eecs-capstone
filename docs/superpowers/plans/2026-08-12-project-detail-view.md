# `projectDetailView` and the Staff Proposer Block Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `getProjectAs`'s whole-row-then-strip with a named `projectDetailView`, so a new column on `projects` cannot ride the anonymous SSR payload of `/projects/$id`. Then show staff, on both the detail and edit pages, whether a project's proposer has an account.

**Architecture:** `projectDetailView(project, viewer)` in `src/lib/project-visibility.ts` names all seventeen fields the two consuming routes read and applies the `notes` rule inside, so the field list and the viewer rule sit together. `stripPrivateFields` is deleted; it has exactly one production caller. The proposer block needs no new query: `getProposerForEditAs` already returns the three fields and `StaffProjectPanel` already fetches them and throws two away.

**Spec:** `docs/superpowers/specs/2026-08-12-project-detail-view-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, and docs.
- **The wire format changes, and it is public.** Fields leave the anonymous payload of `/projects/$id`. Every removed field is unread today.
- **No authorization change.** The inline `canEdit` at `projects-queries.ts:310-314` is preserved verbatim, including its divergence from `canEditProject` on staff-plus-archived.
- **No migration, no new dependency.** `getProposerForEditAs` is untouched, `Forbidden` gate included.
- **Test commands:** `ulimit -n 8192; CI=true npm test` / `npm run test:integration` (docker Postgres; it truncates, so `npm run db:seed:dev` afterwards). Vitest needs the sandbox off in this environment.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **`/projects/$id` and the edit page both change, so `npm run test:accessibility` is required** before the PR.
- **Stage files by name. Never commit to `main`.** Branch `refactor/project-detail-view` already exists and carries the spec commit.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/project-visibility.ts` | gains `ProjectRow`, `ProjectDetailView`, `projectDetailView`; loses `stripPrivateFields` |
| `src/lib/__tests__/project-visibility.test.ts` | six `stripPrivateFields` cases replaced by `projectDetailView` cases |
| `src/server/_internal/projects-queries.ts` | `getProjectAs` returns the projection; the inline embedding patch goes |
| `src/routes/projects/$projectId.tsx` | 22 casts removed |
| `src/routes/_authed/projects/$projectId/edit.tsx` | 15 casts removed |
| `src/server/__tests__/projects.integration.test.ts` | key-set guards; the `proposerEmail` test inverted |
| `src/components/proposer-summary.tsx` | new, read-only, three states |
| `src/components/staff-project-panel.tsx` | keeps the whole `ProposerForEdit`, renders the block |
| `src/components/project-form.tsx` | renders the block above `ProposerPicker` |
| `docs/QUIRKS.md` | the `stripPrivateFields` entry replaced |

---

## Phase 1: the projection

- [ ] **Step 1: write the failing unit tests.** In `src/lib/__tests__/project-visibility.test.ts`, replace the whole `describe("stripPrivateFields", ...)` block (`:148-181`) with the block below, and swap the `stripPrivateFields` import for `projectDetailView`. Reuse the existing `p()` fixture helper, widening it if it does not already supply the seventeen fields.

```ts
describe("projectDetailView", () => {
  const row = p({
    notes: "secret",
    proposerEmail: "who@x.com",
    proposerId: "u-owner",
    status: "published",
  });

  it("carries notes for staff and for the proposer", () => {
    expect(projectDetailView(row, admin).notes).toBe("secret");
    expect(projectDetailView(row, owner).notes).toBe("secret");
  });

  it("nulls notes for anyone else", () => {
    expect(projectDetailView(row, other).notes).toBeNull();
    expect(projectDetailView(row, anon).notes).toBeNull();
  });

  it("names every field it returns", () => {
    // Built field by field rather than by nulling a copy of the row, which is
    // why a new column on projects cannot ride the public payload.
    expect(Object.keys(projectDetailView(row, admin)).sort()).toEqual([
      "contactEmail",
      "contactName",
      "deletedAt",
      "description",
      "id",
      "imageUrl",
      "licenseRestrictions",
      "minQualifications",
      "notes",
      "objectives",
      "prefQualifications",
      "problemStatement",
      "programId",
      "status",
      "teamsSupported",
      "title",
      "url",
    ]);
  });

  it("omits the private link key and the machine columns, staff included", () => {
    for (const key of [
      "proposerEmail",
      "proposerId",
      "programManagerId",
      "publishedAt",
      "archivedAt",
      "searchVector",
      "embedding",
      "embeddingSourceHash",
      "embeddingUpdatedAt",
      "createdAt",
      "updatedAt",
    ]) {
      expect(projectDetailView(row, admin)).not.toHaveProperty(key);
    }
  });

  it("does not mutate the row it was handed", () => {
    const original = p({ notes: "secret" });
    projectDetailView(original, other);
    expect(original.notes).toBe("secret");
  });
});
```

- [ ] **Step 2: run and confirm failure.** `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/project-visibility.test.ts`. Expected: `projectDetailView is not a function`.

- [ ] **Step 3: add the type and the function** to `src/lib/project-visibility.ts`, importing `type Status` from `./project-workflow`. Place them after `canWritePrivateNotes`.

```ts
/** The columns the projection reads, named structurally rather than by import. */
export interface ProjectRow extends VisibleProject {
  contactEmail: string | null;
  contactName: string | null;
  description: string | null;
  imageUrl: string | null;
  licenseRestrictions: string | null;
  minQualifications: string | null;
  objectives: string | null;
  prefQualifications: string | null;
  problemStatement: string | null;
  programId: string | null;
  teamsSupported: number;
  title: string;
  url: string | null;
}

export interface ProjectDetailView {
  contactEmail: string | null;
  contactName: string | null;
  deletedAt: Date | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  licenseRestrictions: string | null;
  minQualifications: string | null;
  notes: string | null;
  objectives: string | null;
  prefQualifications: string | null;
  problemStatement: string | null;
  programId: string | null;
  status: Status;
  teamsSupported: number;
  title: string;
  url: string | null;
}

/**
 * What the project detail and edit pages may read.
 *
 * `/projects/$id` is public, so this payload reaches anonymous viewers. Every
 * field is named here, which is the property worth keeping: adding a column to
 * `projects` cannot leak through it, because nothing copies the row wholesale.
 *
 * Before this, the rule lived in two places. `stripPrivateFields` nulled two
 * columns and the caller patched three more inline, which is what someone does
 * when they find a leak at the call site instead of in the module.
 */
export function projectDetailView(
  project: ProjectRow,
  viewer: Viewer
): ProjectDetailView {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    problemStatement: project.problemStatement,
    objectives: project.objectives,
    minQualifications: project.minQualifications,
    prefQualifications: project.prefQualifications,
    url: project.url,
    contactEmail: project.contactEmail,
    contactName: project.contactName,
    imageUrl: project.imageUrl,
    licenseRestrictions: project.licenseRestrictions,
    teamsSupported: project.teamsSupported,
    programId: project.programId,
    status: project.status as Status,
    deletedAt: project.deletedAt,
    // The one viewer-dependent field, and the reason this cannot be a SQL
    // column map: the rule is which columns for THIS viewer, not which columns.
    notes: canSeePrivateNotes(project, viewer) ? project.notes : null,
  };
}
```

`VisibleProject` types `status` as `string`, so the `as Status` cast above is the single place that narrowing happens. Leave it; the alternative is widening `VisibleProject`, which four other predicates share.

- [ ] **Step 4: delete `stripPrivateFields`** (`:106-118`) and its JSDoc.

- [ ] **Step 5: run the unit tests.** Expected: PASS. Then `npm run check`, `npm run typecheck`. Typecheck will fail in `projects-queries.ts`, which Phase 2 fixes. That is expected; do not commit yet.

---

## Phase 2: the query

- [ ] **Step 1: rewrite `getProjectAs`'s return path** in `src/server/_internal/projects-queries.ts`. Swap the `stripPrivateFields` import for `projectDetailView`. Replace the `stripped` block (`:284-289`) and the `project: stripped` key:

```ts
  const project = projectDetailView(row, viewer);
```

The three inline `embedding*: null` patches go with it: the projection never names those columns, so there is nothing to null.

Rename the loaded row variable if it collides. **Do not touch the `canEdit` block at `:310-314`**, including its divergence from `canEditProject`. Both miss and deny branches keep returning `project: null` with the same five keys.

- [ ] **Step 2: full gate.** `npm run check`, `npm run typecheck`. Typecheck will now surface every route line that read a field the projection dropped. There should be none, because all seventeen consumed fields are carried; if one appears, it is a field the audit missed, so add it to the projection and to the key-set test rather than working around it.

- [ ] **Step 3: invert the `proposerEmail` integration test.** `src/server/__tests__/projects.integration.test.ts:479`, "keeps proposerEmail staff-only", asserts it IS `owner.email` for an admin. Rewrite it to assert the address never reaches the payload for any viewer:

```ts
  it("never returns proposerEmail to anyone, staff included", async () => {
    // It is the private link key. It used to ride the payload for every viewer
    // and be nulled for the wrong ones; now it is not on the wire at all. The
    // staff panel reads it through getProposerForEditAs, which is staff-gated.
    const { project: forAdmin } = await getProjectAs(admin, { id });
    const { project: forAnon } = await getProjectAs(null, { id });
    expect(forAdmin).not.toHaveProperty("proposerEmail");
    expect(forAnon).not.toHaveProperty("proposerEmail");
  });
```

Keep the surrounding setup; only the assertions change.

- [ ] **Step 4: add the key-set guards** in the same file, near the existing `getProjectAs` describe:

```ts
  it("names every field it returns, for an anonymous reader and for staff", async () => {
    // /projects/$id is public. The projection cannot widen on its own; what
    // this catches is a future caller reintroducing a whole-row select above it.
    const PUBLIC_KEYS = [
      "contactEmail",
      "contactName",
      "deletedAt",
      "description",
      "id",
      "imageUrl",
      "licenseRestrictions",
      "minQualifications",
      "notes",
      "objectives",
      "prefQualifications",
      "problemStatement",
      "programId",
      "status",
      "teamsSupported",
      "title",
      "url",
    ];

    const { project: forAnon } = await getProjectAs(null, { id });
    expect(Object.keys(forAnon ?? {}).sort()).toEqual(PUBLIC_KEYS);
    expect(forAnon?.notes).toBeNull();

    const { project: forAdmin } = await getProjectAs(admin, { id });
    expect(Object.keys(forAdmin ?? {}).sort()).toEqual(PUBLIC_KEYS);
    expect(forAdmin?.notes).not.toBeNull();
  });
```

The key set is identical for both; only `notes`'s value differs. That is the design, and asserting both makes it explicit.

- [ ] **Step 5: prove the guard discriminates.** Temporarily add `proposerEmail: project.proposerEmail` to `projectDetailView`'s return, run the guard, confirm it fails naming that key, revert.

- [ ] **Step 6: check the embedding test still passes.** `admin-projects-filter.integration.test.ts:174` asserts `embedding`, `embeddingSourceHash` and `embeddingUpdatedAt` are falsy. Absent is falsy, so it passes unchanged. Confirm rather than assume.

- [ ] **Step 7: full gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run test:integration`.

- [ ] **Step 8: commit.**

```bash
git add src/lib/project-visibility.ts src/lib/__tests__/project-visibility.test.ts \
  src/server/_internal/projects-queries.ts src/server/__tests__/projects.integration.test.ts
git commit -m "refactor(projects): name the fields the detail read returns"
```

---

## Phase 3: the vestigial casts

Separate commit because it is unrelated noise removal that happens to touch the same lines. Stated in the spec: these were never caused by the wide type.

- [ ] **Step 1: remove the 22 `project.*` casts** in `src/routes/projects/$projectId.tsx`, plus `as ProjectDetailData` (`:45`) and the two `as unknown as ProjectDetailData` (`:89`) if the loader's inferred type now serves. Leave `as Comment` (`:101`) alone; it is about comments, not the project.

- [ ] **Step 2: remove the 15 `project.*` casts** in `src/routes/_authed/projects/$projectId/edit.tsx`.

- [ ] **Step 3: gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`. If a cast turns out to be load-bearing, put it back and note which one and why in the commit body.

- [ ] **Step 4: commit.**

```bash
git add src/routes/projects/\$projectId.tsx "src/routes/_authed/projects/\$projectId/edit.tsx"
git commit -m "refactor(projects): drop the vestigial casts on the detail pages"
```

---

## Phase 4: the proposer block

- [ ] **Step 1: write the component test** at `src/test/proposer-summary.test.tsx`, one case per state, following the shape of `src/test/proposer-picker.test.tsx`.

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProposerSummary } from "#/components/proposer-summary";

afterEach(cleanup);

describe("ProposerSummary", () => {
  it("names the account holder when one is linked", () => {
    const { getByText } = render(
      <ProposerSummary
        proposer={{
          accountLinked: true,
          accountName: "Jane Doe",
          email: "jane@oregonstate.edu",
        }}
      />
    );
    expect(getByText("Jane Doe")).toBeTruthy();
    expect(getByText("jane@oregonstate.edu")).toBeTruthy();
    expect(getByText("Account linked")).toBeTruthy();
  });

  it("says an address has no account yet", () => {
    // This is the state that matters: QUIRKS records that an unlinked proposer
    // gets no My projects entry, no notifications, and no review emails.
    const { getByText } = render(
      <ProposerSummary
        proposer={{
          accountLinked: false,
          accountName: null,
          email: "jane@x.com",
        }}
      />
    );
    expect(getByText("jane@x.com")).toBeTruthy();
    expect(getByText("No account yet")).toBeTruthy();
  });

  it("says none on file when there is no address at all", () => {
    const { getByText } = render(
      <ProposerSummary
        proposer={{ accountLinked: false, accountName: null, email: "" }}
      />
    );
    expect(getByText("None on file")).toBeTruthy();
  });
});
```

- [ ] **Step 2: run and confirm failure**, then build `src/components/proposer-summary.tsx`. Props: `{ proposer: ProposerForEdit }`. Read-only, no state, no fetch. Follow `docs/UI-CONVENTIONS.md`: semantic color classes, no hex, `Badge` for the linked/unlinked chip. The "no account yet" case carries the hint "Links automatically when they sign up with this address."

- [ ] **Step 3: render it in `StaffProjectPanel`.** `src/components/staff-project-panel.tsx:95-107` currently destructures `{ email }` and stores `email || null`. Store the whole `ProposerForEdit` instead, defaulting to `{ accountLinked: false, accountName: null, email: "" }`, and keep `proposerAddress` derived from it so the transition dialog's checkbox label at `:335-337` is unchanged. Add a `PanelSection title="Proposer"` rendering `<ProposerSummary />`, placed before the `Status` section.

- [ ] **Step 4: render it in the edit page's staff panel.** `src/components/project-form.tsx:417-433` already has `Panel tone="staff"` and receives `proposer?: ProposerForEdit`. Put `<ProposerSummary />` above `ProposerPicker`, guarded on `showProposer` and on `proposer` being present. `ProposerPicker` itself is untouched.

- [ ] **Step 5: gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`. `src/test/staff-project-panel.test.tsx` already mocks `getProposerForEdit` (`:42-48`), so the new read goes through the same mock; confirm its four `mockResolvedValue` sites (`:81, :131, :173, :204`) still supply a shape the component accepts.

- [ ] **Step 6: commit.**

```bash
git add src/components/proposer-summary.tsx src/components/staff-project-panel.tsx \
  src/components/project-form.tsx src/test/proposer-summary.test.tsx
git commit -m "feat(projects): show staff whether a proposer has an account"
```

---

## Phase 5: the issue and the docs

- [ ] **Step 1: file the GitHub issue** for the `canEdit` divergence. Title: "canEdit on the project detail page disagrees with canEditProject". Body: quote both rules, state that they differ only for staff on an archived project, note that `project-visibility.test.ts:108` pins the module's answer as `true` while the page hides the affordance, and frame the decision as a product question. Capture the issue number for Step 2.

- [ ] **Step 2: replace the `QUIRKS.md` entry.** "Staff-only columns leak unless stripped in `stripPrivateFields`" becomes an entry describing the new shape:
  - `projectDetailView` names every field the detail read returns, so a new column cannot ride the public payload.
  - The strip-then-patch pattern is gone, and the reason it existed is worth one sentence: the rule lived in two places, and the caller's inline embedding patch is what a call-site fix looks like months later.
  - Keep the two-domain comparison, with its new ending: both domains now name their fields, and the inventory paragraph corrected in PR #37 stays as-is.
  - `searchVector` and the three embedding columns still cross into the server process, and stop there.
  - The inline `canEdit` and `canEditProject` disagree for staff on an archived project, with a pointer to the issue from Step 1.

- [ ] **Step 3: commit.**

```bash
git add docs/QUIRKS.md
git commit -m "docs(quirks): replace the stripPrivateFields entry"
```

---

## Phase 6: verify and open the PR

- [ ] **Step 1:** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build`, `npm run test:integration`.
- [ ] **Step 2:** `npm run db:seed:dev`, then `npm run test:accessibility`. Both changed pages are covered by it.
- [ ] **Step 3:** Push, open the PR, wait for `verify` and `integration`.

## Risks

| Risk | Mitigation |
| --- | --- |
| A field the audit missed is dropped | Phase 2 Step 2: it is a typecheck error, not a silent 500. Add it to the projection and the key-set test |
| A cast in Phase 3 was load-bearing | Typecheck catches it. Put it back and say which in the commit body |
| The key-set guard passes vacuously | Phase 2 Step 5 makes it fail on purpose first |
| `staff-project-panel.test.tsx`'s mock returns a shape the new code cannot read | Phase 4 Step 5 checks all four `mockResolvedValue` sites |
| The `canEdit` divergence gets "fixed" by accident while rewriting around it | The plan says do not touch `:310-314`, and the constraint is repeated in Global Constraints |
