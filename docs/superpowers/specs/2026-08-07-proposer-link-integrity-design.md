# Proposer link integrity

Guard the proposer email field when a real account is behind it, and make the
link actually happen when that account appears later.

## Goal

1. When a project is linked to a real account, the proposer email field is
   read-only and changing it requires an explicit re-assign modal. When it is
   not, the field stays free text as it is today.
2. A project whose proposer email matches an account claims that account when
   the address is **verified**, not merely when someone signs up with it.
3. The button beside the field matches the field's height.

## Context

`projects` carries `proposerId` (nullable FK to `user`, `on delete set null`)
and `proposerEmail` (nullable text). `proposerId` is written in exactly two
places, `createProjectAs:87` and `updateProjectAs:155`, both through
`resolveProposerId`, which looks the address up at write time.

**`proposerId` is already the signal this feature needs.** Non-null means a real
account is linked. No new column, no `created_by`, no provenance flag.

`src/components/proposer-picker.tsx` renders the field for both the new and edit
forms with a "Find account" popover. `getProposerEmailForEditImpl`
(`projects-queries.ts:330`) is staff-gated and already resolves the account,
returning its email and discarding everything else it learned.

### The bug this fixes

The picker tells staff:

> "Links this project to the proposer's account, now or when they first sign in
> with this email."

The second half is not implemented. Nothing backfills `proposerId`: there is no
signup hook, no `databaseHooks`, and `resolveProposerId` runs only on write. A
project with `proposerEmail` set and `proposerId` null stays unlinked forever.

That proposer never sees the project under "My projects", never receives status
notifications (`recordStatusChangeNotifications` returns early on a null
`proposerId`), and would never receive the review emails from the companion
spec. The gate in this spec would also mis-read such a project as safe to edit
freely.

## Decisions

| Question | Decision |
|---|---|
| How to know an account is behind the address | `projects.proposer_id is not null` |
| When the field locks | Whenever `proposerId` is set. External proposers stay editable |
| Late linking | Yes, but only on a **verified** address |
| Sequencing | Own spec and plan, same branch as the review emails |

**Verification is the security boundary.** Claiming projects on account creation
alone would let anyone sign up with a colleague's address and take their
projects. Linking only after the address is proven closes that.

## Architecture

### The signal, end to end

```
projects.proposer_id  ──►  getProposerForEdit (staff-gated)
                             │  { accountLinked, accountName, email }
                             ▼
                        ProposerPicker
                             ├─ linked     → read-only field + Re-assign modal
                             └─ not linked → free text + Find account popover
```

### Claiming on verification

```
Password sign-up  → verify link clicked → afterEmailVerification(user)  ─┐
GitHub sign-in    → user created with emailVerified: true               ─┤
                      via databaseHooks.user.create.after                │
                                                                         ▼
                                            claimProjectsForVerifiedUser(id, email)
                                    UPDATE projects SET proposer_id = :id
                                     WHERE lower(proposer_email) = lower(:email)
                                       AND proposer_id IS NULL
```

Two hooks are needed because they cover different paths.
`afterEmailVerification` is called only from better-auth's email-verification
routes (confirmed in `dist/api/routes/email-verification.mjs`), so it does not
fire for GitHub sign-in, which never visits them.
`databaseHooks.user.create.after` covers that path, guarded on
`user.emailVerified === true` so it can never fire for an unverified password
sign-up.

**One thing to confirm during implementation:** whether a GitHub sign-up
actually arrives with `emailVerified` true. The provider source is bundled and
could not be read to settle it. The guard is correct either way and fails in the
safe direction: if GitHub users are not marked verified, they are simply not
claimed by the create hook, and no unverified address ever claims anything. The
implementer must establish the real behavior with a test rather than assume it,
and if GitHub users do arrive unverified, say so in the picker's help text
instead of widening the guard.

### The same address on both a password account and GitHub

`src/lib/auth.ts` sets no `account` config, so better-auth's defaults apply.
From the installed `@better-auth/core` types: `accountLinking.enabled` defaults
to `true` and `disableImplicitLinking` to `false`, so signing in with GitHub at
an address that already has a password account links implicitly. Crucially, the
linking gate requires the **existing local row to be `emailVerified: true`**
before the provider's claim is accepted as proof of ownership. That default is
documented as preventing an attacker who pre-registers an unverified account at
a victim's address from capturing the victim's OAuth identity, and it is
deprecated only because it is becoming unconditional.

Two consequences for this design, both favourable:

- **No double claim.** Linking attaches a second `account` row to the *existing*
  user; no new user is created, so `databaseHooks.user.create.after` does not
  fire on that path.
- **No ordering hazard.** Because linking demands the local row already be
  verified, `afterEmailVerification` has necessarily already run and already
  claimed. GitHub sign-in can never be the first moment a project becomes
  claimable for an address that also has a password account.

The `proposer_id is null` guard in the claim makes it idempotent regardless, so
neither conclusion is load-bearing for correctness. They are the reason no
third hook is needed.

### Matching

Comparison is case-insensitive. `projects_proposer_email_idx` is on the raw
column so a `lower()` comparison will not use it; at a few hundred projects
that is irrelevant, and correctness matters more than an index scan here.

Soft-deleted projects are claimed too. Leaving them unlinked would make a
restore produce an orphaned project, and claiming one has no visible effect
until it is restored.

## Components

### `src/server/_internal/projects-queries.ts` (modify)

`getProposerEmailForEditImpl` becomes `getProposerForEditImpl`, returning:

```ts
interface ProposerForEdit {
  accountLinked: boolean;
  accountName: string | null;
  email: string;
}
```

The precedence it already documents is unchanged: `proposerId` is canonical, so
a linked account's current email wins over the stored column. `accountLinked` is
simply whether that account was found. The old name goes away rather than
staying as an alias.

### `src/server/_internal/claim-projects.ts` (new)

```ts
export async function claimProjectsForVerifiedUser(
  userId: string,
  email: string
): Promise<number>
```

Returns the number of projects claimed. Owns the case-insensitive match and the
`proposer_id is null` guard, so it is safe to call more than once. Never throws
into the auth flow: a failure here must not block a verification or a sign-in,
so the caller catches.

### `src/lib/auth.ts` (modify)

Adds `emailVerification.afterEmailVerification` and
`databaseHooks.user.create.after`, both delegating to
`claimProjectsForVerifiedUser` and both swallowing failure. This is the file
whose module scope already runs `getEmailSender()`, so nothing added here may
throw at import time.

### `src/components/proposer-picker.tsx` (modify)

Gains `accountLinked: boolean` and `accountName: string | null`.

**Not linked:** exactly today's behavior, free text plus the "Find account"
popover.

**Linked:** the input is `readOnly` with muted styling, and the button reads
"Re-assign" and opens a modal. Read-only rather than disabled, because a
disabled input is skipped by keyboard navigation and announced poorly, while the
value still needs to be readable and copyable.

The help text stops promising late linking as a future event and instead states
what is true: linked projects name the account; unlinked ones say the link will
happen when that person verifies the address.

**The re-assign modal** carries the same account search, an explicit
confirmation naming both the current and the new proposer, and a "Remove the
link and set an external proposer" action so staff are not trapped when someone
genuinely has no account.

The new-project form needs no special case: the field starts empty and unlinked,
so it is naturally in free-text mode.

### Height

`Input` is `h-9`; `Button size="sm"` is `h-8`. The button takes `h-9`. Same
mismatch class as the approve-row controls fixed earlier.

## Error handling

| Failure | Behavior |
|---|---|
| Claim query fails during verification | Caught, logged, verification still succeeds |
| Claim query fails during OAuth user creation | Caught, logged, sign-in still succeeds |
| `getProposerForEdit` fails in the picker | Field degrades to unlinked free text, which is today's behavior |
| Staff re-assign to an address with no account | `proposerId` becomes null, field unlocks, project has an external proposer |

## Testing

Integration, `src/server/__tests__/`:

- Verifying an address claims a matching project that had `proposerEmail` set and `proposerId` null.
- Signing up **without** verifying claims nothing; the same project is claimed once verification completes.
- Matching is case-insensitive.
- A project already linked to someone else is not stolen.
- A soft-deleted project is claimed.
- A failing claim does not prevent verification from completing.
- A GitHub sign-up whose address matches an unlinked project: assert whatever
  the real behavior is, having first established it. This is the open question
  in the architecture section, and the test is how it gets settled.
- An address that already has a verified password account, then signs in with
  GitHub: exactly one user row afterwards, the project claimed once, and the
  claim attributable to verification rather than to the GitHub sign-in.

Component, `src/test/proposer-picker.test.tsx` (extending the existing file):

- Linked renders a read-only input, a "Re-assign" button, and no "Find account".
- Not linked renders an editable input and "Find account", as today.
- The re-assign modal's confirm calls `onChange` with the selected address.
- The unlink action clears the value.

## Out of scope

- Any UI for viewing which staff member created a project. `projects` records no
  creator and this spec does not add one; the question it answers is whether an
  account is linked, not who typed the address.
- Merging duplicate accounts.
- Re-assigning from the admin projects table. The gate lives in the picker,
  which is reached from the project edit form.
