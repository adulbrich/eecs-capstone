# Direct-Schema Validators and the Swallowed Errors Implementation Plan

> **For agentic workers:** Implement inline, phase by phase, with a code review gate at the end of each phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the obsolete TanStack Form workaround from both forms by passing the Zod schemas directly, then make the six fields that currently swallow their validation errors show them.

**Architecture:** `@tanstack/react-form@1.32.0` accepts a Standard Schema, and Zod 4.4.3 schemas are Standard Schemas. The only thing blocking the direct path is `.default()`, which makes the schema's input type optional while `FormValidateOrFn<T>` requires input to equal `T`. Dropping the defaults costs nothing: neither schema is used outside its own file and `defaultValues` already supplies every field. `FieldErrors` then owns the one thing genuinely worth sharing, and the six bare render props use it.

**Spec:** `docs/superpowers/specs/2026-08-12-form-schema-validators-design.md`

## Global Constraints

- **Prose contains no emdashes and no emojis.** Covers code comments, commit messages, and docs.
- **`z.infer` output types must not change.** `InventoryFormValues` and `ProjectFormValues` stay identical; only the schemas' input types move. If either changes, stop: something else depends on the defaults.
- **No wire-format change, no migration.** The server's Zod schemas in `src/server/*.ts` are untouched.
- **Test commands:** `ulimit -n 8192; CI=true npm test`. Vitest needs the sandbox off in this environment. No docker needed for any phase; the integration suite is unaffected but runs in Phase 5.
- **Before every commit:** `npm run check` and `npm run typecheck` in full.
- **Both forms render UI, so `npm run test:accessibility` is required** before the PR.
- **Stage files by name. Never commit to `main`.** Branch `refactor/form-schema-validators` already exists and carries the spec commit.
- **Merge with a merge commit, not a squash.**

## File Structure

| File | Responsibility |
| --- | --- |
| `src/components/field-errors.tsx` | new; the coercer, one place |
| `src/test/field-errors.test.tsx` | new; both error shapes |
| `src/components/inventory-form.tsx` | schema loses defaults, validator becomes the schema, two render props gain errors |
| `src/components/project-form.tsx` | same, four render props gain errors |
| `src/test/inventory-form.test.tsx` | new; invalid submit shows the message |
| `src/test/project-form-validation.test.tsx` | new; invalid `proposerEmail` shows the message |
| `docs/QUIRKS.md` | the obsolete adapter entry rewritten |

---

## Phase 1: `FieldErrors`

Additive, and it is what every later phase uses.

- [ ] **Step 1: write the failing test** at `src/test/field-errors.test.tsx`.

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FieldErrors } from "#/components/field-errors";

afterEach(cleanup);

describe("FieldErrors", () => {
  it("renders a string entry", () => {
    const { getByText } = render(<FieldErrors errors={["Title is required"]} />);
    expect(getByText("Title is required")).toBeTruthy();
  });

  it("renders the message off an object entry", () => {
    // Standard Schema issues are objects, so this is the common path now that
    // the schema is passed to the validator directly.
    const { getByText } = render(
      <FieldErrors errors={[{ message: "Must be a valid email" }]} />
    );
    expect(getByText("Must be a valid email")).toBeTruthy();
  });

  it("joins a mixed array", () => {
    const { getByText } = render(
      <FieldErrors errors={["first", { message: "second" }]} />
    );
    expect(getByText("first, second")).toBeTruthy();
  });

  it("renders nothing when there are no errors", () => {
    const { container } = render(<FieldErrors errors={[]} />);
    expect(container.textContent).toBe("");
  });

  it("falls back to String() for an entry with no message", () => {
    const { getByText } = render(<FieldErrors errors={[42]} />);
    expect(getByText("42")).toBeTruthy();
  });
});
```

- [ ] **Step 2: run and confirm it fails.** `ulimit -n 8192; CI=true npx vitest run src/test/field-errors.test.tsx`. Expected: `FieldErrors is not a function`.

- [ ] **Step 3: build the component** at `src/components/field-errors.tsx`. Move the markup from `project-form.tsx:582-592` verbatim so the styling does not drift.

```tsx
/**
 * The one place that knows a form error can be a string or an object.
 *
 * Which one arrives depends on the validator: a Standard Schema (what both
 * forms now pass) produces `{ message }` issues, while a hand-written
 * validator or a server error can produce a bare string. Rendering both is
 * cheaper than making every caller know which it has.
 */
export function FieldErrors({ errors }: { errors: readonly unknown[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <p className="mt-1 text-destructive text-sm">
      {errors
        .map((e: unknown) =>
          typeof e === "string"
            ? e
            : ((e as { message?: string })?.message ?? String(e))
        )
        .join(", ")}
    </p>
  );
}
```

- [ ] **Step 4: run the tests.** Expected: PASS.

- [ ] **Step 5: replace both existing copies.** In `inventory-form.tsx:298-308` and `project-form.tsx:582-592`, swap the inline block for `<FieldErrors errors={field.state.meta.errors} />`. Nothing else in either `Field` changes.

- [ ] **Step 6: gate and commit.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`.

```bash
git add src/components/field-errors.tsx src/test/field-errors.test.tsx \
  src/components/inventory-form.tsx src/components/project-form.tsx
git commit -m "refactor(forms): give the error coercer one home"
```

---

## Phase 2: delete the workaround

The spike already proved both halves of this on `inventory-form.tsx`. Redo it properly and extend to `project-form.tsx`.

- [ ] **Step 1: drop the defaults from `inventoryFormSchema`** (`inventory-form.tsx:23-32`). Remove `.default("")` and `.default([])` from all seven fields; `name` has none. Do not change any other validator in the chain.

- [ ] **Step 2: pass the schema directly.** Replace the whole 16-line `validators` block with:

```ts
    validators: {
      // The schema itself: react-form takes a Standard Schema, and Zod 4
      // schemas are ones. This used to be a hand-rolled safeParse loop, for a
      // typing limitation that no longer exists. See QUIRKS.
      onSubmit: inventoryFormSchema,
    },
```

- [ ] **Step 3: typecheck.** Expected: clean. If it fails on an input-versus-output mismatch, a `.default()` was missed. The error names the field.

- [ ] **Step 4: confirm the inferred type did not move.** Add a temporary line and typecheck:

```ts
const _check: InventoryFormValues = {
  name: "", description: "", categoryIds: [], serial: "",
  label: "", location: "", notes: "", imageUrl: "",
};
```

It must compile with every field required and none optional. Delete it after.

- [ ] **Step 5: repeat for `project-form.tsx`.** Drop `.default("")` from `optionalUrl` (`:28-30`), `optionalEmail` (`:32-34`) and `optionalUuid` (`:36-38`), and from every `.default()` inside `projectFormSchema` (`:40-56`), including `teamsSupported: z.number().int().min(1).max(5).default(1)`. Then swap its `validators` block the same way.

- [ ] **Step 6: gate.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`. `project-form-ai-review.test.tsx` must still pass; it renders the form, so a broken validator shows up there.

- [ ] **Step 7: commit.**

```bash
git add src/components/inventory-form.tsx src/components/project-form.tsx
git commit -m "refactor(forms): pass the schemas to the validator directly"
```

---

## Phase 3: show the errors that are being swallowed

Behaviour change, own commit, own tests.

- [ ] **Step 1: write the project regression test** at `src/test/project-form-validation.test.tsx`. Model the mocks on `src/test/project-form-ai-review.test.tsx`, which already renders `ProjectForm` and knows what to stub.

```tsx
  it("shows the message when the proposer address is not an address", async () => {
    // The bug this guards: onSubmit fails, canSubmit flips false, the Save
    // button greys out, and nothing said why, because this field renders
    // ProposerPicker with no error output of its own.
    render(<ProjectForm onSubmit={vi.fn()} showProposer viewerIsStaff />);

    // Absent first, so a message that was always on the page cannot pass this.
    expect(screen.queryByText(/Must be a valid email/)).toBeNull();

    fireEvent.change(screen.getByLabelText(/title/i), {
      target: { value: "A project" },
    });
    fireEvent.change(screen.getByLabelText(/proposer/i), {
      target: { value: "notanemail" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save|create/i }));

    await waitFor(() =>
      expect(screen.getByText(/Must be a valid email/)).toBeTruthy()
    );
  });
```

Adjust the prop names and the label queries to what `ProjectForm` actually takes; the shape above is the intent, not a literal. If `ProposerPicker`'s input has no accessible label, query it the way `proposer-picker.test.tsx` already does rather than adding one here.

- [ ] **Step 2: run it and confirm it fails** for the right reason: the message never appears.

- [ ] **Step 3: add `<FieldErrors />` to the four bare render props in `project-form.tsx`**: `imageUrl` (`:331`), `programId` (`:362`), `teamsSupported` (`:374`), `proposerEmail` (`:429`). Each render prop returns a `<div>`; put the component last inside it, matching where `Field` puts it.

- [ ] **Step 4: run the test.** Expected: PASS.

- [ ] **Step 5: write the inventory test** at `src/test/inventory-form.test.tsx`, same shape, submitting with an empty `name`, asserting "Name is required" is absent before the click and present after. This one also covers Phase 2's validator end to end, which is what the spike checked by hand.

- [ ] **Step 6: add `<FieldErrors />` to the two bare render props in `inventory-form.tsx`**: `categoryIds` (`:151`), `imageUrl` (`:163`).

- [ ] **Step 7: gate and commit.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`.

```bash
git add src/components/project-form.tsx src/components/inventory-form.tsx \
  src/test/project-form-validation.test.tsx src/test/inventory-form.test.tsx
git commit -m "fix(forms): stop six fields swallowing their validation errors"
```

---

## Phase 4: the `applyServerErrors` cast, only if it can go

Conditional. Do not force this one.

- [ ] **Step 1: try deleting the cast** at `inventory-form.tsx:123-126` and `project-form.tsx:146-149`. Pass `form` directly to `applyServerErrors`.
- [ ] **Step 2: typecheck.** If clean, keep it and commit. **If it fails, revert both and stop**: the spec says the call sites are left alone in that case, and the spec being wrong about it is worth recording in the PR description rather than working around.
- [ ] **Step 3: commit only if Step 2 was clean.**

```bash
git commit -m "refactor(forms): drop the applyServerErrors cast"
```

---

## Phase 5: docs, verify, PR

- [ ] **Step 1: rewrite the obsolete `QUIRKS.md` entry.** "Zod adapter does not accept schemas directly in `validators.onSubmit`" becomes an entry saying:
  - Pass the schema directly; `react-form` takes a Standard Schema and Zod 4 schemas are ones.
  - This was genuinely impossible once, and the entry told people to hand-roll a `safeParse` loop. Both forms carried that loop until this change.
  - What breaks the direct path now is `.default()`: it makes the schema's input type optional while `FormValidateOrFn<T>` requires input to equal `T`. The compiler names the offending field. This is the thing to check first, not the adapter.
  - `@tanstack/zod-form-adapter` is not installed and is not the mechanism.
- [ ] **Step 2: extend the heterogeneous-errors entry.** Standard Schema issues are objects, so the object branch is now the common path, and `FieldErrors` (`src/components/field-errors.tsx`) is where it lives. Note that six render props rendered no errors at all until this change, and what that cost: a greyed-out Save button with no explanation.
- [ ] **Step 3: commit.** `git add docs/QUIRKS.md && git commit -m "docs(quirks): the Zod adapter workaround is obsolete"`
- [ ] **Step 4: full verification.** `npm run check`, `npm run typecheck`, `ulimit -n 8192; CI=true npm test`, `npm run build`, `npm run test:integration`, then `npm run db:seed:dev` and `npm run test:accessibility`.
- [ ] **Step 5:** Push, open the PR, wait for `verify` and `integration`.

## Risks

| Risk | Mitigation |
| --- | --- |
| Dropping a default changes an inferred type | Phase 2 Step 4 asserts the output type explicitly before moving on |
| A default was load-bearing for a consumer outside the file | Already checked: neither schema is referenced anywhere else. Re-grep if the diff surprises you |
| The Phase 3 tests pass vacuously | Every one asserts the message is absent before the click, which is how the spike was validated |
| The submit test cannot reach the proposer input | Phase 3 Step 1 says to query it the way `proposer-picker.test.tsx` already does rather than changing the component to suit the test |
| `teamsSupported` errors now render where they never did | That is the point, but check the layout: it is a narrow `w-24` input and a long message may need the wrapper to allow wrapping |
