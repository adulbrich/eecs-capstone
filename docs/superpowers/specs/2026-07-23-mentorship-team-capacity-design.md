# Mentorship and Team Capacity

Date: 2026-07-23
Status: Approved design, ready for implementation planning

## Summary

Two related capacity concepts are missing from the app. First, a professional
or faculty member who has no project to propose may still want to mentor a
team; today there is no way for them to say so. Second, a project is assumed to
support a single team, but some projects can take several.

This design adds both. On their profile, a user can switch on "I want to mentor
a team" and say how many teams they can take. On the project form, whoever
submits a project can say how many teams it supports (default 1). Staff get a
new `/admin/mentors` page listing interested mentors and can edit a user's
mentor fields there. Everything is informational: opting in as a mentor grants
no new access, and matching mentors to teams is left to people, not code.

The two mentor fields live in Better Auth `additionalFields` (like the existing
`affiliation` and `linkedin`), so they survive the auth-schema regeneration.
`teamsSupported` is a plain column on `projects`.

## Goals

- Let a user declare, on their profile, that they want to mentor and how many
  teams they can take (1 to 5).
- Make it unmistakable in the UI that mentoring is for professionals and
  faculty, not students.
- Require an affiliation before a user can opt in as a mentor (name is already
  required at sign-up).
- Give staff a `/admin/mentors` page to see interested mentors and edit their
  mentor status and capacity.
- Let a project record how many teams it supports (1 to 5, default 1), set on
  the project form and visible to staff only.

## Non-goals (out of scope for this release)

- Automatic or assisted matching of mentors to project teams. Matching is
  manual and out of scope; this release only records intent and capacity.
- Any access, role, or authorization change tied to being a mentor. The flag is
  purely informational.
- A "mentor" role in the role system. Mentoring is orthogonal to `user` /
  `instructor` / `admin`.
- Showing `teamsSupported` on the public project detail page. It is staff-only.
- Enforcing that only professionals/faculty can tick the switch. The UI states
  the intended audience clearly, but does not hard-block a student from opting
  in; admins can correct it from `/admin/mentors`.

## Decisions

- **Mentor fields are Better Auth `additionalFields`, not a separate table.**
  They are 1:1 with the user and read wherever the user is read. The existing
  `affiliation` / `linkedin` fields set the precedent, and the README documents
  that `additionalFields` are restored automatically after a CLI regeneration.
  `wantsToMentor` is `boolean` (default `false`); `mentorTeamCount` is `number`
  (default `1`).
- **One source of truth, editable by both the user and staff.** The user sets
  the fields on their profile; staff edit the same fields on `/admin/mentors`.
  There is no separate approval status. "Change mentor status manually" means an
  admin or instructor edits the same `wantsToMentor` / `mentorTeamCount`.
- **Affiliation is required to opt in.** Name is already required at sign-up, so
  the only new gate is a non-empty affiliation when `wantsToMentor` is true. It
  is validated in the same profile submit, so the two fields cannot drift.
- **The mentor toggle is a switch** (matching the filter switches elsewhere),
  with prominent helper text: "For professionals and faculty, not students."
- **`teamsSupported` is a normal project column, display-gated to staff.** It is
  not sensitive, so it is not stripped from the API response; it is simply
  rendered only in staff contexts (the staff panel on the detail page and the
  admin project row), never in the public project sections.
- **Both counts are bounded 1 to 5.** Min 1, max 5, default 1, integer.
- **`/admin/mentors` is staff-wide (admin and instructor).** Instructors run
  programs and may want to see available mentors, and the page carries no
  role/ban controls, so it is less sensitive than `/admin/users` (which stays
  admin-only). The mentor-editing server functions are gated with the same
  `isStaff` check.

## Schema changes

One migration, after regenerating the Better Auth schema.

- **User** (via `additionalFields` in `src/lib/auth.ts`, then
  `npx @better-auth/cli generate` into `src/db/auth-schema.ts`):
  - `wantsToMentor: { type: "boolean", required: false, defaultValue: false }`
  - `mentorTeamCount: { type: "number", required: false, defaultValue: 1 }`
- **`projects`** (hand-written in `src/db/schema.ts`, next to the other
  scalar columns):
  - `teamsSupported: integer("teams_supported").notNull().default(1)`
    (`integer` is already imported).

Regeneration and migration follow the README's documented flow:

```bash
npx -y @better-auth/cli generate --config src/lib/auth.ts --output src/db/auth-schema.ts
npm run db:generate
npm run db:migrate
```

The generated columns land on the `user` table with their defaults, so existing
rows get `wantsToMentor = false` and `mentorTeamCount = 1` with no backfill.

## Profile (user self-service)

A "Mentorship" section on `/profile`, styled like the existing sections.

- A `Switch` labelled "I want to mentor a team", with a muted helper line
  directly under it: "For professionals and faculty, not students."
- When the switch is on, a number field "How many teams can you mentor?"
  appears (default 1, min 1, max 5). When off, the field is hidden and the
  count is not submitted as meaningful.
- The mentor fields are part of the existing profile save (`onSaveProfile` /
  `updateProfile`), so the affiliation-required-when-mentor rule is enforced in
  one atomic submit.
- If the user switches mentoring on while affiliation is empty, the save is
  rejected with a field-level error on affiliation: "Affiliation is required to
  opt in as a mentor." The affiliation input is in the same profile form, so
  the message points at a visible field.

## Admin/staff: `/admin/mentors`

A new route `src/routes/_authed/admin/mentors/index.tsx`, gated to staff
(`admin` or `instructor`); non-staff are redirected to `/`, matching the other
admin routes' `beforeLoad`.

- Loads the interested mentors via a new staff server function `listMentors`,
  returning users where `wantsToMentor = true`: `id`, `name`, `email`,
  `affiliation`, `mentorTeamCount`, ordered by name.
- Renders a table (reusing `AdminTable`): Name, Affiliation, Email, Teams, and a
  control column.
- Each row lets staff edit that user's mentor fields inline or via a small form:
  toggle `wantsToMentor` off (removing them from the list) and adjust
  `mentorTeamCount` (1 to 5). Saved through a new staff server function
  `setUserMentorStatus(userId, { wantsToMentor, mentorTeamCount })`.
- Empty state uses the shared `EmptyState` component: "No mentors yet."
- A `NavCard` linking to `/admin/mentors` is added to the `/admin` overview
  "Manage" section (icon from `lucide-react`, e.g. `Handshake`), visible to
  staff (not gated behind `isAdmin`).
- The existing `/admin/users/$id` detail page gains a read-only line for
  context: "Mentor: yes (N teams)" when `wantsToMentor`, else nothing. Editing
  stays on `/admin/mentors`.

## Project form and display

- `teamsSupported` is added to `projectFormSchema` in
  `src/components/project-form.tsx` as `z.number().int().min(1).max(5).default(1)`,
  and to `PROJECT_EDITABLE_FIELDS` in `src/server/_internal/projects.ts` so it is
  persisted and diffed by `createProjectAs` / `updateProjectAs`.
- The project form gains a small "Teams this project can support" control
  (a number input or a 1-to-5 select), default 1. It is set by whoever edits the
  project (proposer or staff); it is not a staff-only field.
- Display is staff-only: `teamsSupported` is shown in the staff panel on the
  project detail (`src/components/staff-project-panel.tsx`) and, optionally, in
  the admin project row. It is not added to the public `Section` blocks on the
  detail page.

## Server functions and validation

- **`updateProfile`** (`src/server/profile.ts`): `profileSchema` gains
  `wantsToMentor: z.boolean().default(false)` and
  `mentorTeamCount: z.number().int().min(1).max(5).default(1)`, plus a
  `.refine` that requires a non-empty `affiliation` when `wantsToMentor` is
  true, with `path: ["affiliation"]`. `updateProfileForCurrentUser` adds both
  fields to its `db.update(user).set({ ... })`.
- **`listMentors`** (new, `src/server/users.ts` + `_internal/users.ts`): staff
  only (`assertStaff` / `isStaff`), selects the mentor-interested users.
- **`setUserMentorStatus`** (new, staff): validates
  `{ userId, wantsToMentor: boolean, mentorTeamCount: 1..5 }` and updates that
  user's row. Follows the existing `*As(viewer, ...)` + `*ForCurrentUser`
  split so it is directly testable.
- **Project create/update**: `teamsSupported` flows through the existing
  `createProjectAs` / `updateProjectAs` value maps; no new server function.

## Testing

- Unit: `profileSchema` accepts a mentor opt-in with an affiliation, rejects an
  opt-in with a blank affiliation (error on the `affiliation` path), and clamps
  `mentorTeamCount` to 1 to 5. Project schema clamps `teamsSupported` to 1 to 5
  and defaults to 1.
- Integration: `updateProfileForCurrentUser` persists `wantsToMentor` and
  `mentorTeamCount`; `listMentors` returns only opted-in users and refuses a
  non-staff viewer; `setUserMentorStatus` updates a target user and refuses a
  non-staff viewer; creating/updating a project persists `teamsSupported`.
- Accessibility: the profile mentor switch has an accessible name and its helper
  text is associated; the `/admin/mentors` table and controls pass the axe run.

## Risk callouts

- **The auth-schema regeneration must not lose the existing custom columns.**
  `affiliation` and `linkedin` are restored from `additionalFields` on
  regeneration; the two new fields join them. The migration should be reviewed
  to confirm it only adds the two boolean/number columns and does not drop or
  alter the existing ones.
- **`teamsSupported` is set by the proposer but shown only to staff.** A
  proposer sees the field on their own edit form (they set it) but not on the
  public detail page. This is intended: it is capacity planning data, not a
  public project attribute.
- **The switch does not enforce audience.** A student can technically opt in;
  the mitigation is clear copy plus staff visibility and editing on
  `/admin/mentors`. If hard enforcement is wanted later, it is a validation
  addition, not a redesign.
