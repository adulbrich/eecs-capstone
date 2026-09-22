# ONID takes an address off an unproven account, deleting its password

`onidUserInfo` in `src/lib/auth.ts` calls `releaseUnverifiedAddress` before
Better Auth decides whether to link, and when the address is held by a row that
is unverified, unbanned and has nothing but a `credential` account on it, that
row loses the credential, gains `email_verified`, and takes the display name
from the ID token. The row itself survives with everything attached to it; what
is deleted is the password and any session. This is a sign-in that deletes data
on a live application, which is why it is written down. The problem it fixes is
that sign-up is open, so anybody could register `student@oregonstate.edu` with a
password of their choosing, and
[ADR-0039](./0039-sign-in-limits-are-sized-for-a-shared-address.md) already
noted the consequence: `accountLinking.requireLocalEmailVerified` defaults to
true, so that student's first ONID sign-in failed with `account not linked` at
exactly the term start this work is sized for, and the way out was a four-step
maze most people would report as broken. The comment on `accountLinking` argues
against merging an authenticated identity into an unproven address and it is
right, but it is right about the naive version, linking and leaving the password
in place, where whoever set that password inherits an account the university has
now vouched for. Deleting the credential at the same time, in the same
transaction and before the verified flag is written, removes that entirely: the
ordering is load-bearing rather than tidiness, because the reverse order failing
in between would leave a verified account whose password a stranger knows.

None of that shape is ours to claim, and a later reader should not think it was
invented here. Better Auth ships `revokeUnprovenAccountAccess` in
`better-auth/dist/db/revoke-unproven-account-access.mjs`, which no-ops on a
verified row, deletes every `credential` account, revokes the sessions, and
argues the same thing in its own docstring: an `emailVerified: false` row
"carries no proof that the password on it belongs to the mailbox owner", so the
verified owner must "inherit no password or session that predates the proof".
The magic link and email OTP plugins both call it. What no plugin covers is this
path, because `oauth2/link-account.mjs` never calls it, so an OAuth identity
resolving to an unproven row gets the refusal rather than the cleanup. That gap
is what B1 fills. Read this as the OAuth-side equivalent of the framework
helper rather than as an independent design. What
makes taking the address the right call rather than merely a convenient one is
that the proof is not close. OSU has interactively authenticated the person
against the tenant `onid-profile.ts` pins, with whatever MFA the university
enforces, and nobody can obtain an ONID identity for somebody else's address,
which is more than our own emailed link establishes. Two rows are refused and
keep today's behaviour: one that another provider is already linked to, because
somebody has authenticated as that user, and one that is banned, because
releasing would hand a student an account an admin has shut and clearing the ban
is a person's decision rather than a sign-in's. Both refusals are deliberately
stricter than the helper above, which deletes the credential accounts and then
proceeds regardless of what else is attached, so a squatter who had linked
GitHub to the unproven row would keep that link on an account the verified owner
now holds, and which does not look at `banned` at all. If this is ever replaced
by a call to the helper, those two conditions have to move in front of it rather
than disappear with it. Decided 2026-09-21 in #554.

## Consequences

The display name is overwritten deliberately, because
`accountLinking.updateUserInfoOnLink` defaults to false and Better Auth's link
path would otherwise leave a student carrying the name a squatter typed. Project
claiming has to be called here by hand: `afterEmailVerification` is not on this
path, `user.create.after` fires only at creation, and the link path's own
`updateUser({ emailVerified: true })` is skipped because the flag is already
true by the time it looks, so without the explicit call a released student would
keep their address and silently lose their proposals. A failure returns the
profile unchanged rather than throwing, which reproduces `account not linked`
rather than breaking the ONID callback for everyone. The refusal copy in
`src/components/oauth-error-banner.tsx` is unchanged and is now shown for the
two refused cases rather than the common one; `docs/ONID-SSO.md` carries the
same split. What this does not do is stop the squatting: an attacker can still
register an address they do not own, and #554's "considered and not chosen"
section names the clean fix, which is to hold a pending sign-up and create no
row until the address is proved. That remains the right answer and remains more
work than this.

This raises the stakes of a question `onid-profile.ts` currently leaves open, and
that is worth stating because the answer was not needed before. That file asserts
`emailVerified: true` on an ONID profile and rests the soundness on the issuer
pin plus a claim about who the registration is published to, and it notes that a
guest invited into the OSU tenant would pass the issuer check while carrying a
home-tenant email, with `idp` differing from `iss` as the discriminator nobody
has implemented. Until B1, the worst such a guest could do was create or link
their own account. Now an ONID sign-in can TAKE an address off a password
account, so if a guest is in scope, and if their home tenant sets a mail
attribute Entra does not verify, the payoff for the same trick is somebody
else's row rather than their own. The maintainer confirmed on 2026-09-22 that
the College of Engineering restriction the comment cites is not real, that all
ONID works, and that whether guests can reach the registration is not known.
Implementing the `idp` check blind is its own risk, because no real token from
this tenant has been seen and refusing on a claim that turns out to be absent
would lock out everyone, so the answer is to ask UIT rather than to guess.

One hazard is left open and is worse than it was, which is the reason to write
it here rather than let a later reader find it. `emailVerification.sendOnSignIn`
still mails a live verification link to the address on every sign-in the
squatter makes with the password they chose, and `autoSignInAfterVerification`
is true, so an owner who clicks that link confirms the squatter's row and is
signed into it. Nothing in this change closes that: B1 runs only on the ONID
callback, the notice in B2 is a different, tokenless message, and the cap bounds
how often the link is sent rather than what it grants. What this change adds is
a second cost to the same click, because a row that has been verified is exactly
the row `releaseUnverifiedAddress` refuses, so clicking it also forfeits the
ONID route that would otherwise have worked. The mitigation shipped here is
copy: `verificationEmail` now tells the reader plainly not to use the link if
they did not create the account, and names ONID and a password reset as the two
safe doors. It promises nothing about ONID, because the two refusals above mean
the app does not always keep that promise, and only the reset is described by
its outcome. That is a warning rather than a control, and it is proportionate
only because the clean fix is the pending sign-up rewrite, which is out of scope
for #554 by the issue's own words.
