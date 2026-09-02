# Student-proposed projects and mentors

Date: 2026-09-02
Status: Design approved in chat, implementing on `claude/issue-75-mentorship`.
Issue: #75. Feeds #34 (analytics) and #84 (account deletion scrubs `mentor_email`).

## Summary

Two columns on `projects` and one derived public state:

- `student_proposed`, boolean, not null, default false. Public. Staff-editable only.
- `mentor_email`, text, nullable. Staff-only, never in a public payload. Staff-editable
  only. Applies to every project, not only student-proposed ones.

The public sees, in order of precedence:

| `mentor_email` | Matching account | Public shows |
| --- | --- | --- |
| null | n/a | "Seeking mentor", only when `student_proposed` |
| set | none | nothing |
| set | found | that account's `name` |

The mentor is resolved at read time by `lower(user.email) = lower(projects.mentor_email)`.
No `mentor_id`, no new caller of `claimProjectsForVerifiedUser`: mentorship grants no
permission, so there is nothing an id would need to be trusted for.

## What the issue got wrong about the tree

The issue says the new fields match `isSponsored`, and that the staff panel already has an
`isSponsored` control. Neither holds. `isSponsored` is on the shared project form and
round-trips through `updateProject`, so the proposer edits it. There is no staff-only field
edit in the app today. This design introduces that pattern rather than widening the form.

## Write path

One server function, `updateProjectMentorship({ id, studentProposed, mentorEmail })`, in
`src/server/projects.ts`, level `staff` in `access-contract.ts`. Its seam
`updateProjectMentorshipAs(viewer, data)` in `src/server/_internal/projects.ts`:

1. `assertStaff(viewer)`.
2. Load the project or throw `Project not found`.
3. Normalize `mentorEmail`: trim, empty becomes null. Stored as typed, matched
   case-insensitively.
4. `diffRowFields(existing, { studentProposed, mentorEmail })`. No change returns
   `{ id, updated: false }` and writes nothing.
5. In one transaction: update the two columns plus `updatedAt`, insert a
   `project_edit_log` row with the editor, `changedFields`, old and new values.

Neither column joins `ProjectInput`. That is what makes "non-staff cannot set it"
structural: `updateProject` has no key for either, and the only endpoint that does is
staff-gated.

No embedding refresh: neither column feeds the embedding source text.

## Read path

`src/server/_internal/project-summary.ts` gains a `mentorNameSql` correlated subquery:

```sql
(select u.name from "user" u where lower(u.email) = lower(projects.mentor_email) limit 1)
```

and `projectSummarySelect` gains `studentProposed` and `mentorName`. That is the one
projection the public listing, search, bookmarks and my-projects share, so all four pick up
both fields with no change to their joins. Same shape as the `categories` subquery in the
admin export.

`getProjectAs` selects the row plus `mentorName` through the same SQL, and
`projectDetailView` names `studentProposed` and `mentorName`. `mentorEmail` is not named in
either view, so it cannot reach an anonymous or proposer payload. The `PUBLIC_KEYS` pin in
`projects.integration.test.ts` grows by exactly those two keys.

A staff-gated read, `getProjectMentorship({ projectId })` in `projects-queries.ts`, returns
`{ studentProposed, mentorEmail, mentorName }` to prefill the panel. Same gate and shape as
`getProposerForEdit`.

## Derived state

`src/lib/mentorship.ts` exports one pure function:

```ts
export type MentorDisplay = "seeking" | { name: string } | null;
export function mentorDisplay(p: {
  mentorName: string | null;
  studentProposed: boolean;
}): MentorDisplay;
```

Card, row and detail page all call it, so the three states cannot be computed three ways.
The middle row of the table above is the one it exists for: an address with no account
shows nothing, because "Seeking mentor" would be false and the email would publish a person
who has not signed up.

## Surfaces

- `ProjectCard` and `ProjectRow`: a "Student proposed" badge (`outline` variant) and a
  "Seeking mentor" badge (`status` variant, warning tokens) beside the status badge. A
  resolved mentor name is not shown on the listing; it is a detail-page fact.
- `/projects/$projectId`: the same badges under the title, and a "Mentor" section showing
  the resolved name when there is one.
- `StaffProjectPanel`: a "Mentorship" `PanelSection` between Proposer and Status, with the
  checkbox, the email input, a hint line stating whether the address matches an account
  (name, or "No account with this address yet"), and a Save button. Saves call
  `updateProjectMentorship` and then `onChanged()`.
- Admin projects table and CSV export: unchanged. Not in the issue's surface list; the
  analytics in #34 read the columns directly.

## Schema

```ts
studentProposed: boolean("student_proposed").notNull().default(false),
mentorEmail: text("mentor_email"),
```

Migration 0017 through `npm run db:generate`, reviewed to confirm it adds two columns and
nothing else.

## Visibility summary

| Field | Public | Proposer | Staff | Edits |
| --- | --- | --- | --- | --- |
| `student_proposed` | yes | yes | yes | staff |
| `mentor_email` | no | no | yes | staff |
| resolved mentor name | yes | yes | yes | derived |
| "Seeking mentor" | yes | yes | yes | derived |

## Tests

Integration, `src/server/__tests__/projects.integration.test.ts` or a new
`mentorship.integration.test.ts`:

- `mentorEmail` is absent from `getProjectAs` for an anonymous viewer and for the proposer;
  the exact public key set is asserted.
- All three public states resolve, including an address that matches no account and one
  that starts matching after the account is created.
- The match is case-insensitive.
- A non-staff viewer calling `updateProjectMentorshipAs` gets `Forbidden`, and
  `updateProjectAs` with the two keys in its input leaves both columns untouched.
- A save writes a `project_edit_log` row naming the changed fields; an unchanged save
  writes none.
- The listing projection carries `studentProposed` and `mentorName`.

Unit:

- `mentorDisplay` covers the three states plus the "student proposed with a mentor" case.
- `projectDetailView` key set in `project-visibility.test.ts` includes the two new keys and
  excludes `mentorEmail`.

Deferred to #84: deleting the mentor's account nulls `mentor_email`. Nothing can be
deleted until that issue lands.
