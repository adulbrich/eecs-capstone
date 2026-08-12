# `projectDetailView`, and a proposer block for staff: design

Date: 2026-08-12

Third candidate from the architecture review of the inventory and projects hot
spots, plus one feature that landed on top of it during design. `getProjectAs`
returns the whole `projects` row and strips afterwards, in two places, which is
the pattern `QUIRKS.md` has an entry warning about.

The governing principle:

> **Subtractive privacy needs someone to remember. Additive privacy does not.**

---

## What ships today on a public page

`getProjectAs` (`src/server/_internal/projects-queries.ts:257-323`) runs a bare
`db.select()` and returns the row through `stripPrivateFields`. `/projects/$id`
is fully public, so this payload reaches anonymous viewers.

| Column | Handling today |
| --- | --- |
| `notes` | conditionally nulled in `stripPrivateFields` (`project-visibility.ts:111-113`) |
| `proposerEmail` | conditionally nulled there too (`:114-116`) |
| `embedding`, `embeddingSourceHash`, `embeddingUpdatedAt` | nulled by the **caller**, inline at `projects-queries.ts:286-289` |
| `proposerId`, `programManagerId`, `publishedAt`, `archivedAt`, `searchVector`, `createdAt`, `updatedAt` | **neither read nor stripped**: riding the payload |

The rule for what a viewer may read lives in two places, and the split is the
tell: someone hit the embedding leak and patched the call site instead of the
module. `searchVector` is a tsvector on an anonymous page.

## Two corrections to the review that proposed this

**The 37 casts are not caused by the wide type.** The review claimed
`VisibleProject = {...} & Record<string, unknown>` widens every other field to
`unknown`, so the routes cast to compensate and the deepening would buy type
leverage. That is wrong. `stripPrivateFields<T extends VisibleProject>(project:
T): T` returns the inferred Drizzle row; the intersection is a *constraint*, not
a widening. All 37 casts (34 `as string`, 2 `as number`, 1 `as Date`) are
vestigial and deletable today, independent of this change. They are removed here
because the projection touches those exact lines, not because it enables it.

**`canEdit` does not mean what `canEditProject` means.** `getProjectAs:310-314`
reimplements the rule inline, and the two disagree:

```ts
// inline, in the query:          staff on an archived project => false
!!viewer && !deletedAt && (staff || owner) && status !== "archived"
// canEditProject (:57-74):       staff on an archived project => TRUE
if (isStaff(viewer)) return true;   // short-circuits before the archived check
```

`project-visibility.test.ts:108` pins the module's answer as `true`. So the
detail page hides the edit affordance from staff on an archived project while
`updateProjectAs`, which uses the real predicate, would accept the write.

**The inline logic is preserved verbatim.** A refactor must not change an
authorization answer, and which of the two is correct is a product question
(may staff edit an archived project?) that deserves its own change. It is filed
as a GitHub issue and noted in `QUIRKS.md`.

## Design

One projection in `src/lib/project-visibility.ts`, beside the predicates that
already live there:

```ts
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

export function projectDetailView(
  project: ProjectRow,
  viewer: Viewer
): ProjectDetailView;
```

Seventeen fields, the union of what the two consuming routes actually read.
`notes` is assigned `canSeePrivateNotes(project, viewer) ? project.notes : null`
inside the projection, so the rule and the field list sit in one place.

`stripPrivateFields` is **deleted**, along with its six unit tests. It has
exactly one production caller (`projects-queries.ts:285`), which becomes zero.
`VisibleProject` stays: `canSeeProject`, `canEditProject`, `canSeeStatusHistory`
and `canSeePrivateNotes` all take it and all have production callers.

The rest of the return shape is unchanged: `{ project, history, canEdit,
viewerIsStaff, viewerIsOwner }`, and `history` was already a named projection of
six columns (`:295-302`).

### The decisions behind that, and why

- **`proposerEmail` is omitted entirely, not made staff-only.** No consumer
  reads it off the project payload; the edit route takes the proposer address
  from `getProposerForEditAs`. Today it reaches the SSR payload for every viewer
  and is made safe by a null assignment. Omitting removes the private link key
  from the public wire instead of nulling it for the wrong audience.

- **`notes` is `string | null` in one shape, not a viewer-chosen second view.**
  Inventory splits into `publicItemView` and `staffItemView` because staff get
  eleven extra fields. Here it is one, both routes already render it on
  truthiness, and a union type would make them narrow for a distinction they do
  not draw. The property that matters, that the field is named in the projection
  so a new column cannot ride, holds either way.

- **The projection is applied in JS, not as a SQL column map.** This is the
  opposite of the local precedent: `projectSummarySelect` and
  `adminProjectSummarySelect` in the same file are named SQL column maps. The
  deciding factor is that the rule is not "which columns" but "which columns
  **for this viewer**", and half of that cannot live in SQL. Splitting one rule
  across a query literal and a JS step is exactly what produced the current bug.
  One module, one rule, one test surface, unit testable without docker.

  The cost, stated plainly: `searchVector` and the three embedding columns keep
  crossing from Postgres into the server process on every detail read. They stop
  at the server rather than reaching the client. Excluding just `searchVector`
  at the SQL level stays available if it ever shows up in a profile.

- **`status` is typed `Status`, `deletedAt` stays a `Date | null`.** The column
  is `projectStatusEnum`, so the row already carries the union and the `as
  Status` casts are vestigial. A soft-deleted project only reaches staff at all,
  since `canSeeProject` returns false for everyone else when it is set, so the
  date is not a leak.

## The proposer block

Separate commit, same PR. Staff need to see who a project belongs to and, more
importantly, whether that person has an account at all: `QUIRKS.md` records that
an unlinked proposer gets no "My projects" entry, no status notifications, and
no review emails.

**No new query is needed.** `getProposerForEditAs` already returns
`ProposerForEdit { accountLinked: boolean; accountName: string | null; email:
string }` and already throws `Forbidden` for non-staff.
`StaffProjectPanel` already calls it (`staff-project-panel.tsx:95-107`) and
discards two of the three fields, keeping only the email for the transition
dialog's checkbox label (`:335-337`).

A read-only `ProposerSummary` component renders the three states:

| State | Shown |
| --- | --- |
| Linked | the account holder's name, the address, and an "Account linked" badge |
| Address, no account | the address, a "No account yet" badge, and a hint that it links automatically when they sign up with that address |
| Neither | "None on file" |

`user.name` is `notNull`, so a linked account always has one.

It is used in two places: the staff panel on `/projects/$id`
(`StaffProjectPanel`), and the staff panel inside `ProjectForm`
(`project-form.tsx:417-421`), above the existing `ProposerPicker`. One component
rather than two renderings, because the same three-state rule in two hand-written
copies is the duplication this review keeps finding. `ProposerPicker`'s editing
behaviour is untouched.

**The proposer data deliberately does not ride `projectDetailView`.** Putting it
there would add a staff-only nested object to a payload anonymous viewers
receive, to answer a question a staff-gated server function already owns.

## Tests

- **Unit**, replacing the six deleted `stripPrivateFields` cases: `notes` is
  carried for staff and for the proposer, nulled for anyone else, and the
  projection omits every column not in the seventeen.
- **Integration**, an exact-key-set guard on `Object.keys(project).sort()` for an
  anonymous read and for a staff read, so the `notes` difference is pinned too.
  This matters more than the inventory equivalent because the payload is public.
- **`projects.integration.test.ts:479` is inverted**, not deleted. It asserted
  `proposerEmail` is present for admin; it now asserts the address never reaches
  the payload for any viewer. A test that pinned the old design becomes a guard
  on the new one.
- **`project-visibility.test.ts:148-181` is deleted** with the function it tests.
- **`ProposerSummary`** gets a unit test per state.

## Constraints

- **The wire format changes**, and this one is public: fields leave the
  anonymous SSR payload of `/projects/$id`. Every removed field is unread today.
- **No authorization change.** The `canEdit` divergence is preserved verbatim.
- **No migration, no new dependency.**
- **`getProposerForEditAs` is untouched**, including its `Forbidden` gate.
- **Stage files by name. Never commit to `main`.** Branch
  `refactor/project-detail-view`.

## Deliberately not in scope

- **Resolving the `canEdit` divergence.** Filed as an issue. It is a product
  question about whether staff may edit an archived project, and the two rules
  currently disagree in a way that favours neither answer.

- **Collapsing `Status` and `projectStatusEnum`.** Two hand-maintained copies of
  the same six strings, the same duplication `InventoryStatusBadge` has against
  `ItemStatus`. Both deserve one pass together.

- **Excluding `searchVector` at the SQL level.** Available later, unrelated to
  where the rule lives.

- **`getProjectAs`'s sibling read paths.** `projectSummarySelect` and
  `adminProjectSummarySelect` already exclude staff columns in SQL and are not
  touched.

## Documentation

The existing `QUIRKS.md` entry "Staff-only columns leak unless stripped in
`stripPrivateFields`" is replaced rather than deleted. Its hazard is gone, but
its value was the comparison it drew between the two domains' strategies, and
that comparison now has a different ending: both name their fields, and the
reason projects took longer is worth a sentence. Deleting it outright loses the
record that this was ever a hazard, which is what stops someone reintroducing a
whole-row select.

The new entry also notes that the inline `canEdit` and `canEditProject`
disagree, with a pointer to the issue, so the next reader does not assume the
inline copy is authoritative.

## What this buys

- **Additive privacy on a public page.** A new column on `projects` is invisible
  until someone names it, rather than private until someone remembers.
- **Locality**: one module decides what leaves the server, instead of a module
  plus an inline patch at the call site.
- **`searchVector` and six other unread columns leave the public payload.**
- **A deleted module**: `stripPrivateFields` and its six tests go, and the
  complexity concentrates rather than moving.
- **37 vestigial casts go**, and `status` arrives typed.
- **Staff can see whether a proposer has an account**, which decides whether
  that person is receiving any notification at all.
