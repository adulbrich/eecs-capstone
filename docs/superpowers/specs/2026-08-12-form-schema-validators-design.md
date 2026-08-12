# Pass the schemas directly, and show the errors that are being swallowed: design

Date: 2026-08-12

Fourth candidate from the architecture review of the inventory and projects hot
spots. The review proposed extracting a duplicated TanStack Form workaround into
a shared module. Investigating it found the workaround is obsolete, and found a
user-facing bug behind it.

The governing principle:

> **Before extracting a workaround, check whether the thing it works around is
> still there.**

---

## The workaround no longer works around anything

`docs/QUIRKS.md` tells you to hand-roll a `safeParse` loop because
"passing a Zod schema directly to `validators.onSubmit` fails type-checking".
That was true once. It is not true now:

- `@tanstack/react-form@1.32.0` types the validator as
  `FormValidateOrFn<T> = FormValidateFn<T> | StandardSchemaV1<T, unknown>`.
- Zod 4.4.3 schemas declare `"~standard"`, so they satisfy `StandardSchemaV1`.
- `@tanstack/zod-form-adapter` is not installed and is not the mechanism any
  more.

Extracting the loop into a shared helper, as the review proposed, would have
enshrined a workaround for a constraint that no longer exists.

### What actually blocks the direct path, and it is not the adapter

A spike confirmed the direct path fails to compile, and the error names the
cause precisely:

```
The types of 'input.description' are incompatible between these types.
  Type 'string | undefined' is not assignable to type 'string'.
```

`FormValidateOrFn<TFormData>` wants `StandardSchemaV1<TFormData, unknown>`, so
the schema's **input** type must equal the form's data type. Every `.default("")`
makes that field optional on input, so input can never equal output while the
defaults are there.

**Dropping the defaults fixes it, and they were serving nothing.** Neither
`inventoryFormSchema` nor `projectFormSchema` is referenced outside its own
file, and both forms' `defaultValues` already supply every field
(`initial?.x ?? ""`), annotated `satisfies XFormValues`. `z.infer` reads the
**output** type, so `InventoryFormValues` and `ProjectFormValues` do not change.

The spike also confirmed the runtime half rather than assuming it: with the
schema passed directly, submitting an empty name still renders "Name is
required", and the message is absent before the click, so the check was not
vacuous. Standard Schema produces `{ message }` issues, which the existing
coercer already handles.

## Six fields silently swallow their errors

The coercer appears exactly once per file. Every field rendered through a raw
`form.Field` render prop displays nothing. Six sites, five distinct fields,
since `imageUrl` appears in both forms:

| File | Fields with no error rendering |
| --- | --- |
| `project-form.tsx` | `imageUrl` (:331), `programId` (:362), `teamsSupported` (:374), `proposerEmail` (:429) |
| `inventory-form.tsx` | `categoryIds` (:151), `imageUrl` (:163) |

`proposerEmail` is reachable in practice. `optionalEmail` requires a valid
address, and `ProposerPicker` lets staff type freely whenever no account is
linked. So:

1. Staff type `notanemail` into the proposer field and click Save.
2. `onSubmit` validation fails and blocks the submit.
3. `canSubmit` flips false, so the Save button greys out.
4. **Nothing explains why.** `formError` only ever carries server errors, and
   the field renders no message of its own.

A disabled Save button with no visible reason is the defect, and it is the
reason this candidate is worth doing at all. The duplication was the symptom
that led here.

## Design

Three changes, three commits.

**1. Delete the workaround.** Drop `.default()` from both schemas and from
`optionalUrl`, `optionalEmail` and `optionalUuid`, then pass the schemas
straight to `validators.onSubmit`. That removes 16 lines from each form.

**2. Extract `FieldErrors`.** One small component wrapping the coercer:

```tsx
export function FieldErrors({ errors }: { errors: readonly unknown[] }) {
  // Entries are strings or { message } objects depending on which validator
  // produced them, and Standard Schema issues are the object shape.
}
```

It replaces the two existing copies, and it is what the six bare render props use.

**3. Render the errors that are currently dropped.** Add `<FieldErrors />` to
the six raw `form.Field` render props.

### What is deliberately not shared

The two local `Field` components look duplicated and are not, past a point.
Project extracts a `FieldControl`, adds a markdown branch and an AI-suggestion
panel; inventory inlines a two-way Input/Textarea switch. A single shared
`Field` carrying `markdown`, `suggestion` and `onApply` would be a wide
interface over a thin implementation, which is the shape this review keeps
arguing against. `FieldErrors` is the piece that earns extraction, because it
has two existing callers **and** six more that need it.

The `descriptionId` and description-paragraph block are also duplicated, about
eight lines. They stay: a component that renders one `<p>` when a string is
present is a pass-through, and the deletion test says the complexity would move
rather than concentrate.

### The `applyServerErrors` call site

Duplicated verbatim in both forms, cast included:
`form as unknown as Parameters<typeof applyServerErrors>[0]`.

**Tried, and it stays.** The guess in an earlier draft of this spec was that the
cast existed because `AnyForm` is `any`, so deleting the hand-rolled validator
might make it unnecessary. That was wrong, and the compiler says why:

```
Type '<TField extends "name" | "description" | ... >(field: TField, ...) => void'
  is not assignable to type '(field: string, ...) => void'.
    Type 'string' is not assignable to type '"name" | "description" | ...'
```

`FormLike` in `src/lib/apply-server-errors.ts` declares `setFieldMeta(field:
string, ...)`, while the real form types that parameter as a union of its own
field names. Parameter contravariance makes the narrower form unassignable to
the wider interface, and that has nothing to do with the validator or with
`AnyForm`. Removing it would mean generifying `FormLike` over the field-name
union, which is a change to a shared helper with its own reasoning. The call
sites are left alone.

## Tests

Nothing here has any coverage today. The only test touching either form
exercises the AI-review path.

- **`FieldErrors`** unit tests: a string entry, a `{ message }` entry, a mixed
  array, and the empty case rendering nothing. Which shape arrives depends on
  the validator, and the component must handle either.
- **One submit test per form**: submit invalid, assert the message renders next
  to the field. For `project-form.tsx` use `proposerEmail`, so the test is the
  regression guard for the bug above rather than a generic exercise.
- Both submit tests must assert the message is **absent before** the click. A
  test that only checks presence afterwards cannot tell a working validator from
  a string that was always on the page.

## Constraints

- **`z.infer` output types do not change.** `InventoryFormValues` and
  `ProjectFormValues` stay identical; only the schemas' input types move.
- **No wire-format change, no migration.** The server's own Zod schemas in
  `src/server/*.ts` are untouched; these two are client-side form schemas with
  no other consumer.
- **Rendering the dropped errors is a behaviour change**, in its own commit
  with its own test.
- **Stage files by name. Never commit to `main`.** Branch
  `refactor/form-schema-validators`, cut from `main` after PR #41 merged.

## Deliberately not in scope

- **Sharing the two `Field` components.** Argued above: they diverge where it
  matters.
- **The `AnyForm = any` escape.** `QUIRKS.md` documents it as a separate
  instability, and whether it is still needed is its own question, the same
  shape as the one this spec just answered for the Zod adapter. Worth asking
  later, with a spike, not assumed here.
- **The other eight forms.** Every other `<form>` in the app uses plain
  `useState` error handling and no client-side Zod validation. Only these two
  use `useForm`, so there is no third caller to generalize for.

## Documentation

The `QUIRKS.md` entry "Zod adapter does not accept schemas directly in
`validators.onSubmit`" is rewritten rather than deleted. It was true when
written, and the next person who hits a type error on `validators.onSubmit`
needs the current answer, which is "check whether your schema's input type
matches the form's data type", not "hand-roll the loop again". The rewrite names
`.default()` as the thing that breaks the match.

The heterogeneous-errors entry stays and gains a sentence: Standard Schema
issues are objects, so the object branch of the coercer is now the common path
rather than the unusual one, and `FieldErrors` is where it lives.

## What this buys

- **A silent failure becomes visible.** An invalid proposer address currently
  greys out Save and says nothing.
- **32 lines of workaround deleted**, not relocated.
- **A `QUIRKS.md` entry stops instructing people to write code they no longer
  need.**
- **Six render props gain error rendering**, and one component owns it.
- **First test coverage** for validation on either form.
