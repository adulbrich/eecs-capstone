# Project review emails

Two new transactional emails around the project review workflow, plus the
restructuring of email content they require.

## Goal

1. When a proposer submits a project for review, email the capstone review inbox
   with the title, the proposer, the description, and a link to review it.
2. When staff approve a project or request changes, email the proposer with the
   outcome and, for requested changes, the staff note. The approval message says
   the project will be published later and that no further email will follow.

Staff can suppress either proposer email per action, and the UI says plainly
who is about to be emailed.

## Context

The app sends exactly two emails today, both from `src/lib/auth.ts` through
Better Auth: email verification and password reset. Every other user-facing
signal is a row in `notifications`, rendered by the bell. SES went live in
`af9be90`; the transport is real and production runs it.

All project transitions funnel through two functions in
`src/server/_internal/projects.ts`: `performTransitionAs` (workflow-validated)
and `forceTransitionAs` (staff override). Both already load the project, write
`project_status_history`, and call `recordStatusChangeNotifications` inside one
transaction. This is the hook point, and there is no third path.

There is no `rejected` status. The enum is `draft, submitted, approved,
changes_requested, published, archived`. `changes_requested` already requires a
non-empty comment (`assertChangesRequestedHasComment`), and that comment is the
rejection note.

`projects` carries both `proposerId` (nullable FK to `user`) and
`proposerEmail` (nullable text), the same person-or-address pattern used for
inventory holders. `recordStatusChangeNotifications` returns early when
`proposerId` is null, so a proposer without an account currently receives
nothing at all. Email reaches them.

## Decisions

| Question | Decision |
|---|---|
| Which transition is "rejected" | `changes_requested`, reusing its mandatory comment |
| Where the staff address lives | New `EMAIL_REVIEW_INBOX` env var, not `EMAIL_REPLY_TO` |
| The "you won't be notified" claim | Worded as no further **email**; the in-app publish notification stays |
| Does `forceTransitionAs` email | Yes, same rule as `performTransitionAs` |
| Can staff skip the email | Yes, per action, opt-out with the box checked by default |

`EMAIL_REVIEW_INBOX` equals `EMAIL_REPLY_TO` today but means something
different: one is where replies land, the other is who reviews submissions.
Conflating them would be a trap the first time either changes.

## Architecture

```
performTransitionAs / forceTransitionAs
  └─ db.transaction: status, history, in-app notification   [unchanged]
  └─ AFTER commit: notifyTransitionByEmail(...)             [new]
         ├─ resolve recipients
         ├─ templates.ts  → { subject, text, html }         [pure, tested]
         └─ EmailSender.send(...)                           [transport]
```

The send happens after the transaction commits, never inside it. The precedent
is `refreshProjectEmbedding`, two lines below in the same function, whose
comment says a Bedrock call must not hold a transaction open and its failure
must not roll back the publish. The reasoning is stronger for SES: a failed
email must not undo an approval. Failures are caught and logged, matching how
`listMyItemsAs` swallows overdue-notification errors so they cannot 500 a read.

### Content moves out of the transports

Today content is baked into `ses-sender.ts` as `EmailContent` constants, and
`ConsoleEmailSender.write` can only print `{ to, url }`. Neither shape expresses
"title, proposer, description, link", so both transports would need rewriting in
any case.

`src/lib/email/templates.ts` becomes the single home for content: pure functions
taking structured input and returning `{ subject, text, html }`. Transports
become dumb. `SesEmailSender` ships what it is handed; `ConsoleEmailSender`
prints the rendered subject and text. The two existing emails move to the same
model rather than sitting beside it as a parallel path.

This makes content unit-testable with no AWS mocking, and means the next email
touches no transport code.

### HTML escaping

`ses-sender.ts:78` builds HTML by raw interpolation:

```ts
Html: { Data: `<p>${content.intro}</p><p><a href="${msg.url}">${content.cta}</a></p>` }
```

Safe today only because every value is a constant or a server-generated URL.
The new emails interpolate a user-supplied title, description, and staff
comment. A project titled `<img src=x onerror=...>` would deliver that markup
into the staff review inbox.

`templates.ts` owns a single tested `escapeHtml` helper, and every interpolated
value passes through it. The plain-text alternative needs no escaping.

## Components

### `src/lib/email/templates.ts` (new)

Pure functions, no I/O:

- `escapeHtml(value: string): string`
- `verificationEmail({ url }): RenderedEmail`
- `passwordResetEmail({ url }): RenderedEmail`
- `projectSubmittedEmail({ title, proposerName, proposerEmail, description, url }): RenderedEmail`
- `projectApprovedEmail({ title, comment, url }): RenderedEmail`
- `projectChangesRequestedEmail({ title, comment, url }): RenderedEmail`

`RenderedEmail` is `{ subject: string; text: string; html: string }`.

Description is truncated at 600 characters, followed by "Open the project to
read the full proposal." The column allows 5000.

### `src/lib/email/sender.ts` (modified)

```ts
export interface EmailSender {
  send(to: string, email: RenderedEmail): Promise<void>;
}
```

The named per-message methods go away; callers render a template and hand the
result to `send`. `getEmailSender()` keeps its current shape and factory
behavior. `EMAIL_FROM` remains the only hard requirement of
`createSesEmailSender`, because `getEmailSender()` runs at module scope in
`src/lib/auth.ts` and a throw there fails the app's boot rather than just its
email.

The transports learn nothing about recipients or new variables.
`EMAIL_REVIEW_INBOX` is a recipient, which is `project-emails.ts`'s concern, not
a sender's.

### `src/lib/auth.ts` (modified)

The two Better Auth callbacks render a template and call `send`:

```ts
sendVerificationEmail: async ({ user, url }) => {
  await emailSender.send(user.email, verificationEmail({ url }));
},
```

Behavior is unchanged; only the call shape moves. This file is why `EMAIL_FROM`
must never become optional.

### `src/server/_internal/project-emails.ts` (new)

```ts
export async function notifyTransitionByEmail(
  project: { id, title, description, proposerId, proposerEmail },
  target: Status,
  comment: string | null,
  sendEmail: boolean,
): Promise<void>
```

Owns recipient resolution, `EMAIL_REVIEW_INBOX`, link construction, and the
decision not to send. Obtains its transport from `getEmailSender()`. Never
throws; catches, logs, returns. Called after the transaction in both transition
functions.

Links are absolute, since they are read outside the app:
`${process.env.BETTER_AUTH_URL}/projects/${id}`. That variable already holds the
app host in every environment (`infra/ecs.tf` sets it from `var.domain_name`),
so no new configuration is needed. If it is unset the email is skipped rather
than sent with a broken relative link.

Recipient rules:

- `submitted` goes to `EMAIL_REVIEW_INBOX`. Skipped when the variable is unset.
  The body identifies the proposer, so this path does one lookup on `user` by
  `proposerId` for the display name. With no account the name is omitted and the
  address alone is shown; with neither, "Unknown proposer". The submission email
  is still worth sending in that case, because the review link is the point.
- `approved` and `changes_requested` go to `proposerEmail` when set, otherwise
  the account address resolved from `proposerId`, otherwise nothing.
- Every other target sends nothing, so publishing stays email-silent exactly as
  the approval copy promises.
- `sendEmail === false` sends nothing regardless of target.

### `src/server/_internal/projects.ts` (modified)

`performTransitionAs` and `forceTransitionAs` fold their optional tail into one
options object:

```ts
performTransitionAs(viewer, id, target, comment?, opts?: { embed?: EmbedFn; sendEmail?: boolean })
```

A sixth positional boolean after an optional test seam is how signatures rot.
This touches existing call sites and their tests; the churn is accepted in
exchange for room for the next flag.

### `src/server/projects.ts` (modified)

`transitionInputSchema` gains `sendEmail: z.boolean().default(true)`. Defaulting
true means a partial caller sends mail rather than silently swallowing it, which
is the safer failure direction.

### `src/components/staff-project-panel.tsx` (modified)

Below the comment textarea in the transition dialog, shown only for `approved`
and `changes_requested`:

```
☑ Email the proposer (alex@oregonstate.edu)
  Uncheck to change the status silently.
```

Checked by default, so the email is what happens when staff do nothing. Naming
the actual recipient is the staff-facing "an email will be sent" signal.

With no reachable address, the checkbox is disabled and reads "No address on
file, no email will be sent", so silence is never a surprise. This requires the
panel to receive the resolved proposer address, which it does not currently
take; the props gain it.

### Infrastructure

`EMAIL_REVIEW_INBOX` is wired like the existing email variables: a
`var.email_review_inbox` in `infra/variables.tf` defaulting to
`eecs-capstone@oregonstate.edu`, passed in `infra/ecs.tf`, and documented in
`.env.example` and `DEPLOYMENT.md` section 9.

## Error handling

| Failure | Behavior |
|---|---|
| SES rejects or times out | Caught in `notifyTransitionByEmail`, logged, transition already committed and stands |
| `EMAIL_REVIEW_INBOX` unset | Submission email skipped, logged once, no throw |
| Proposer has no address | Proposer email skipped, no throw, UI already said so |
| `EMAIL_FROM` unset under `ses` | Unchanged: throws at boot, by design |

No retries and no queue. At capstone volume a lost review email is recoverable
by looking at the queue in the app, and a retry layer is not worth its failure
modes yet.

## Testing

Unit, alongside the existing `src/lib/email/__tests__/`:

- `templates.test.ts`: each function returns the expected subject; the body
  carries the link, title, and comment; `escapeHtml` neutralizes `<`, `>`, `&`
  and quotes; a project titled `<img src=x onerror=alert(1)>` appears escaped in
  `html` and raw in `text`; description over 600 characters is truncated and
  carries the trailing sentence.
- `ses-sender.test.ts` and `console-sender.test.ts`: updated for `send`.

Integration, in `src/server/__tests__/projects.integration.test.ts`:

- Submitting emails the review inbox with the project title.
- Approving emails the proposer; the body says it will be published later and
  that no further email follows.
- Requesting changes emails the proposer with the staff note.
- Publishing emails nobody.
- `sendEmail: false` emails nobody while still writing status history and the
  in-app notification.
- A proposer with `proposerEmail` and no `proposerId` still gets the email.
- A project with neither address transitions without error and sends nothing.
- A send that rejects does not roll back the transition.

These assert against a captured sender rather than a real one: the integration
suite sets `EMAIL_TRANSPORT=console` and spies on `send`, so assertions read the
rendered subject and text directly. No integration test touches AWS, and none
asserts on stderr.

## Out of scope

- Email preview before sending.
- Any record of whether mail was sent. If an audit trail is wanted later, the
  natural home is a column on `project_status_history`, not a new table.
- Digest or batching of review-inbox mail.
- The unrelated gap that there is no way to resend a verification email
  (`emailVerification.sendOnSignIn` is unset and no resend control exists).
  Noted here only so it is not mistaken for part of this work.
