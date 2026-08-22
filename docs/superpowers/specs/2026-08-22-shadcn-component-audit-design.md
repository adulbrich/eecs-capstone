# shadcn/ui component audit: consistency and accessibility (issue #27)

Date: 2026-08-22
Status: Architecture review. Findings and verdicts settled; no implementation plan yet.

## Summary

The upstream registry ships 63 `registry:ui` components. This project has installed
15. That gap is not itself the problem: most of the 48 missing ones (carousel,
sidebar, input-otp, chart) have no place here. The problem is the subset where a
hand-rolled component in `src/components/` reimplements a primitive that exists
upstream, and does it slightly differently each time it is written.

Two of those cases are worse than drift, because `docs/UI-CONVENTIONS.md` has
**codified** them as house style: the "Status tabs" pattern and the "Disabled
pagination" pattern are both documented hand-rolled markup standing in for a
primitive (`tabs`, `pagination`) that was never installed. The design system doc is
currently teaching the workaround.

The accessibility axis has a different shape than expected. Route coverage in the
Playwright suite is broad and the suite is green. It is green partly because the
defects that the hand-rolled markup actually has are ones axe cannot see.

## Method

- Registry enumerated live from `https://ui.shadcn.com/r/index.json` and per-component
  manifests from `/r/styles/new-york/<name>.json`, rather than recalled.
- Convention conformance measured by grep across 139 `.tsx` files, organized by rule
  rather than by file.
- Every "adopt the primitive" verdict checked against that primitive's actual
  manifest `dependencies` and its import list, because two components in the same
  family resolve opposite ways and one recommended component smuggles in a
  framework dependency (see finding 1).
- The accessibility suite was read, not run. `.github/workflows/ci.yml` was checked
  to establish whether anything runs it.

## What is already right

Worth stating, because a flat list of complaints would misrepresent the codebase and
would put good deep modules on the chopping block.

- `AdminDataTable` is a correct deep module. The CSS-only responsive card collapse,
  the `data-label` derivation, and the `sortingFn` rule are all documented and all
  earned. Not a finding.
- `FieldErrors`, `SectionHeading`, and `EmptyState` each carry a comment explaining
  the specific bug that motivated them. That is the right way to justify a bespoke
  component.
- `ViewToggle` hand-rolls its buttons but supplies `role="group"`, `aria-label`, and
  `aria-pressed`, with a `biome-ignore` explaining the choice. It is correct ARIA.
- Token discipline is near-total: 2 hardcoded hex values in `src/`, both inside a
  comment in `brand-provider.tsx` explaining contrast ratios. Zero in live markup.
- Forbidden palette classes are down to a long tail: 7 `text-neutral-`,
  5 `border-neutral-`, 5 `bg-neutral-`, 4 `text-red-`, 1 `bg-white`, 1 `text-blue-`.

## Findings

Ordered by severity, most severe first.

### 1. Destructive confirmation has no design-system representation at all

Four call sites gate an irreversible action on the native `confirm()`:

- `src/components/owner-project-actions.tsx:37` (delete draft)
- `src/components/staff-project-panel.tsx:172` (delete draft)
- `src/routes/_authed/admin/programs/$programId.tsx:73`
- `src/routes/_authed/admin/categories/$categoryId.tsx:79`

And one reports a partial-success result through the native `alert()`:
`src/routes/_authed/my/items.tsx:121`.

`alert-dialog` is not installed. Neither is `sonner`, and there is no toast anywhere
in the codebase, so the app has **no non-blocking feedback channel**. Native dialogs
are unstyled, ignore the brand and the dark palette, are suppressible by the browser,
block the main thread, and are invisible to the accessibility suite because axe
cannot scan a page whose script is parked on a modal browser prompt.

This is the single largest architecture gap in the UI layer: the most consequential
interaction in the app, deleting something permanently, is the one interaction with
no component behind it.

**Verdict: adopt `alert-dialog`, and adopt `sonner` with one edit.** The `alert()` at
`my/items.tsx:121` is a toast, not a dialog; it reports a result nobody needs to
acknowledge.

`alert-dialog` is clean: `@radix-ui/react-alert-dialog` plus the `button` we already
have.

`sonner` is not. Its manifest declares `["sonner", "next-themes"]` and the wrapper
imports `useTheme` from `next-themes` to sync the toaster to the active theme. That is
the same defect that permanently disqualifies `form` in finding 7: a registry component
dragging in a framework coupling. It does not disqualify `sonner`, because the
dependency is removable and the toast is worth having, but the component cannot be
installed unmodified.

The replacement is simpler than a port, because this app has no JS theme state to port
to. Dark mode is pure CSS: `styles.css:7` declares
`@custom-variant dark (@media (prefers-color-scheme: dark))` and the dark block at
`styles.css:93` is a plain media query. There is no theme class, no provider state, and
no user-facing toggle. So the `useTheme` call has no question to answer here. Drop the
`next-themes` import and pass `theme="system"`, which is sonner's own media-query mode
and matches what the CSS already does. Install `sonner` alone; do not install
`next-themes`.

### 2. The design doc codifies hand-rolled tabs, and the markup is not a tablist

`UI-CONVENTIONS.md` documents the pattern under "Component patterns > Status tabs".
Two implementations follow it: `src/routes/_authed/my/items.tsx:52` and
`src/routes/_authed/admin/categories/index.tsx:325`. Both render a `flex` div of raw
`<button type="button">` with a `border-b-2` and an inline `borderBottomColor`.

There is no `role="tablist"`, no `aria-selected`, no `aria-controls`, and no roving
tabindex, so a screen reader announces a row of unrelated buttons and a keyboard user
tabs through every tab individually instead of arrowing between them. The active tab
is conveyed by border color plus `font-medium`, so the non-color cue exists and 1.4.1
is satisfied, but the structure is not.

axe reports nothing here, because a `<button>` with a text label is a valid button.
The suite is green and the tablist is still missing.

**Verdict: adopt `tabs`.** Radix supplies the roles, `aria-selected`, and arrow-key
navigation by construction. Replace the documented pattern in the doc with the
primitive.

### 3. One pagination control, two implementations, one of them keyboard-reachable

Also codified, under "Component patterns > Disabled pagination". Three sites, and
reading them shows the doc describes a pattern the code applies two different ways.

| Site | Element | Disabled how | Keyboard-reachable when disabled |
| --- | --- | --- | --- |
| `src/routes/projects/index.tsx:89` | `<Link>` | `pointer-events-none` only | **Yes** |
| `src/routes/_authed/admin/users/index.tsx:357` | `<Link>` | `pointer-events-none` only | **Yes** |
| `src/routes/inventory/index.tsx:143` | `<button>` | `disabled` + `pointer-events-none` | No |

The two `<Link>` sites carry the defect. `pointer-events: none` suppresses mouse
events only: the anchor stays in the tab order, is still announced as a link, and
Enter still activates it. There is no `aria-disabled` and no `tabIndex={-1}`. On page
1 a keyboard user can focus a control that looks disabled, activate it, and get no
feedback and no state change, because the target clamps to `Math.max(1, page - 1)`.

`inventory/index.tsx` is correct: a `disabled` button leaves the tab order and
announces its state, and its `pointer-events-none` class is redundant but harmless.

So the defect is 2 sites, not 3. The consistency finding is the whole table: one
control, two implementations, one doc entry describing them as if they were one
thing.

Harmless in outcome, wrong in behavior at two sites, and undetectable by axe, which
has no rule for a focusable element neutralized by `pointer-events`.

**Verdict: adopt `pagination`.** The clamping logic stays; the disabled semantics
move into the primitive.

### 4. Nothing runs the accessibility suite, and its rule set could not catch these anyway

Start with the gate, because it reframes the rest. `.github/workflows/ci.yml` runs
`check`, `typecheck`, `test`, `build`, and `check:compression`, plus `test:integration`
in a second job. **`test:accessibility` is in neither.** The suite is manual-only, so
nothing in the pipeline would notice an accessibility regression, and this review makes
no claim about whether it currently passes.

That matters more than it first reads. `npm test` deliberately excludes the a11y suite
(CLAUDE.md says so), which is a reasonable local-speed choice, but the CI job that was
supposed to be the other half of that trade was never added. The result is an
accessibility suite that exists, is well built, and gates nothing.

Route coverage within it is genuinely broad: 21 routes plus 6 fixture-backed detail
pages across `public`, `user`, and `admin` suites. The gap is not which pages are
visited, it is which **states** are.

| Suite | Interactions before `checkA11y` |
| --- | --- |
| `admin.a11y.test.ts` | 33 |
| `public.a11y.test.ts` | 0 |
| `user.a11y.test.ts` | 0 |

Every interactive assertion in the suite exercises `AdminDataTable`'s column menu and
sort headers. The entire interactive budget went to the one component that was
already correct. No test opens a `Sheet`, a `Dialog`, or a `Select` before scanning,
and none can reach a `confirm()` at all.

Compounding this, `checkA11y` runs `withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"])`
on the load state. That rule set is blind to all three findings above, and to a
fourth: 6 of 54 `Input`/`Textarea` instances have neither an `id` for a `Label
htmlFor` nor an `aria-label`, relying on `placeholder` alone.

- `src/components/comment-thread.tsx` (2 textareas)
- `src/components/inventory-filter-bar.tsx`
- `src/components/projects-filter-bar.tsx`
- `src/components/inventory-lifecycle-panel.tsx`
- `src/routes/_authed/my/items.tsx`

axe does not flag these, because `placeholder` is a fallback in the accessible-name
computation, so the accessible name is non-empty. The name disappears the moment the
user types, which is exactly when they need it. `admin/mentors/index.tsx` gets this
right with an `aria-label`, so the correct pattern is already in the codebase.

**Verdict, two parts.** Add `test:accessibility` to CI; an ungated suite is the
cheapest thing on this list to fix and the precondition for every other a11y claim
here meaning anything. Then move the behaviors in findings 1 to 3 into Radix-backed
primitives that are correct by construction, rather than chasing more axe rules.
Extending the rule set is the weaker lever, and the `public`/`user` suites having zero
interaction assertions should be recorded as a known limit either way.

### 5. Four badge components, one shape, copy-pasted with two divergences

`status-badge.tsx`, `inventory-status-badge.tsx`, `overdue-badge.tsx`, and
`category-chip.tsx` each independently write the same box:

```
inline-flex items-center rounded px-2 py-0.5 font-medium text-xs   (inventory-status, overdue)
inline-block            rounded px-2 py-0.5 font-medium text-xs   (status-badge)
inline-flex items-center gap-1 rounded px-2 py-0.5      text-xs   (category-chip)
```

`status-badge` uses `inline-block` where its siblings use `inline-flex`;
`category-chip` drops `font-medium`. Neither divergence is intentional. `badge` is
not installed.

The nuance that stops this from being a plain adopt: upstream `badge` is a `cva`
component with four fixed variants (`default`, `secondary`, `destructive`, `outline`)
and no way to express this app's status-token mapping, which resolves a domain status
to a `--status-*` foreground/background pair.

**Verdict: adopt `badge` as the shape layer only.** The four components keep their
status-to-token maps and render through `<Badge>` for the box, killing the divergence
without flattening the domain semantics into four generic variants.

### 6. Four different card idioms

- Inline Tailwind `rounded-lg border border-border bg-card`, repeated across ~8
  components (`project-card`, `inventory-card`, `project-row`, `inventory-row`,
  `owner-project-actions`, both filter bars, `admin/index`).
- `panel.tsx`, a real component with tone variants.
- `.island-shell`, a CSS class used by the four auth pages.
- `.feature-card`, a CSS class used by the landing page.

`card` is not installed. The inline repetition is the drift; the two CSS classes are
deliberate, distinct surface treatments.

**Verdict: adopt `card` for the repeated inline idiom.** Keep `panel`, `island-shell`,
and `feature-card`, and record in the doc that they are separate surfaces rather than
candidates for consolidation, so the next audit does not re-open this.

### 7. `field` is the right primitive here; `form` never will be

These resolve opposite ways and the difference is worth pinning down, because a future
audit will otherwise keep proposing `form`.

| Primitive | npm dependencies | Verdict |
| --- | --- | --- |
| `form` | `react-hook-form`, `@hookform/resolvers`, `zod` | **Never adopt.** This project uses TanStack Form. Installing it would put a second form library in the tree. |
| `field` | none. Registry deps `label`, `separator` only | **Adopt.** Form-library agnostic. |

`field` is the natural home for the documented `space-y-1.5` label/input wrapper and
for `FieldErrors`, and it would have prevented finding 4's unlabelled inputs by making
the labelled shape the default one.

### 8. Dead and near-dead primitives

`src/components/ui/slider.tsx` has **zero** importers anywhere in `src/`. It is dead
code carrying a `@radix-ui/react-slider` dependency.

`table.tsx` and `sheet.tsx` each have exactly one importer (`AdminDataTable` and
`SiteHeader`). Both are correct and intended; noted only so the next audit does not
mistake a single importer for drift.

**Verdict: delete `slider.tsx` and its Radix dependency** unless a planned feature
needs it. Per the repo's no-shims rule, delete rather than deprecate.

### 9. Two conventions the doc states and the code contradicts

Both are cases where the code is right and the doc is stale.

**Page width.** The doc says `max-w-4xl` is "the standard page width". Counting only
route roots, matched on the doc's own `px-4 py-6 md:p-8` signature so inner containers
do not inflate the tally: 7 at `max-w-2xl`, 3 at `max-w-4xl`, 2 at `max-w-md`, 1 at
`max-w-3xl`, 1 at `max-w-sm`. The `max-w-2xl` majority is the form and detail pages,
where a narrower measure is the better choice, and the `max-w-md` / `max-w-sm` pages
are auth cards. The doc should describe the tiers and what selects each, instead of
naming one standard that a minority of pages follow.

**Breakpoint tiers.** The doc declares a deliberate two-tier system where `sm:`,
`lg:`, and `xl:` are "reserved for the rare case". The card grids use a five-tier
ladder at four sites, identically each time:

```
grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5
```

Four consistent uses is a pattern, not an exception. Card grids are the one thing that
genuinely needs more tiers, since column count should track available width
continuously. Total third-tier usage outside this ladder is small: 17 `sm:` hits in 11
files, 4 `lg:`, 3 `xl:`.

### 10. Raw `<button>` inventory

17 raw `<button>` sites across 11 files, plus one raw `<input type="file">`
(`image-uploader.tsx:201`, which is the correct way to drive a hidden file input).

Findings 1 to 3 account for the ones that matter. The remainder split into: correct
and deliberate (`view-toggle.tsx`, `admin-data-table.tsx` sort headers), and
unreviewed (`notification-bell.tsx` x2, `staff-project-panel.tsx:260`,
`projects-filter-bar.tsx:248`, `image-uploader.tsx` x4,
`integrations/better-auth/header-user.tsx:24`). The second group needs a per-site pass
against the `Button` variant table; it is not a single architectural decision.

## Verdict summary

| Hand-rolled | Primitive | Verdict |
| --- | --- | --- |
| `confirm()` x4 | `alert-dialog` | Adopt |
| `alert()` x1 | `sonner` | Adopt, dropping the `next-themes` import for `theme="system"` |
| Status tabs x2 | `tabs` | Adopt |
| Pagination x3 (2 buggy, 2 implementations) | `pagination` | Adopt |
| 4 badge components | `badge` | Adopt as shape layer; keep status-token maps |
| Inline card idiom x8 | `card` | Adopt |
| `space-y-1.5` wrapper, `FieldErrors` | `field` | Adopt |
| TanStack Form usage | `form` | **Never adopt.** Would add react-hook-form |
| `AdminDataTable` | `table` | Keep. Deliberate deep module |
| `panel.tsx` | `card` | Keep. Distinct surface with tone variants |
| `.island-shell`, `.feature-card` | `card` | Keep. Distinct surfaces |
| `ViewToggle` | `toggle-group` | Keep. ARIA is already correct; adopting buys consistency, not correctness. Judgment call |
| `slider.tsx` | n/a | Delete. Zero importers |

## Proposed `docs/UI-CONVENTIONS.md` deltas

Not applied in this pass.

1. Replace "Component patterns > Status tabs" with `Tabs` usage.
2. Replace "Component patterns > Disabled pagination" with `Pagination` usage.
3. Add a "Destructive actions" section: `AlertDialog` for anything irreversible,
   `sonner` toast for results that need no acknowledgement, and a flat ban on native
   `confirm()` / `alert()`.
4. Add to "Form inputs": every input needs an `id` matched by `Label htmlFor`, or an
   `aria-label` when no visible label exists. State that `placeholder` is not a label,
   with the reason (it disappears on input, and axe will not catch it).
5. Add a "Why not shadcn `form`" note recording the react-hook-form dependency, so the
   next audit does not re-propose it.
6. Correct "Page wrapper padding" to describe the width tiers rather than naming
   `max-w-4xl` as the single standard.
7. Amend "Mobile-first layout" to sanction the card-grid responsive ladder as the
   named exception to the two-tier rule, and keep the two-tier rule for everything
   else.
8. Add the badge shape rule: status-bearing badges render through `<Badge>` and supply
   their own `--status-*` tokens.
9. Record that `panel`, `island-shell`, and `feature-card` are distinct surfaces, not
   consolidation candidates.

## Suggested sequencing

Three groups, independently shippable, most value first.

0. **Gate the suite.** Add `npm run test:accessibility` to `.github/workflows/ci.yml`.
   One job, no code change, and it is what makes every later group verifiable.
1. **Destructive actions.** Install `alert-dialog`, and `sonner` with the `next-themes`
   import replaced by `theme="system"`. Replace 4 `confirm()` and 1 `alert()`. Highest
   user-visible risk, no dependency on the others.
2. **Documented patterns.** Install `tabs` and `pagination`, replace 5 sites, rewrite
   the two doc sections. Both fix real keyboard and screen-reader behavior.
3. **Shape consolidation.** `badge`, `card`, `field`; delete `slider`; sweep the
   palette-class tail and the unlabelled inputs. Cosmetic and mechanical, and the
   safest to defer.

Each group ends with `npm run test:accessibility`, which group 0 makes meaningful, and
group 2 should add the first interaction-state assertions to `public.a11y.test.ts` and
`user.a11y.test.ts`, which currently have none.

## Non-goals

- Applying any of it. This pass produces verdicts, not commits.
- Widening the a11y suite beyond the interaction states that groups 1 and 2 introduce.
- Auditing the 48 registry components with no call site here.
- Revisiting `AdminDataTable`, whose design is settled and documented.
