# Mail about an unproven address is capped per recipient, and fails open

`reserveVerificationMail` in `src/server/_internal/verification-sends.ts` allows
three messages an hour to one address, counted in a new `verification_sends`
table, and both `emailVerification.sendVerificationEmail` and the
duplicate-sign-up notice spend the same allowance. It replaces a control that
was never meant to be one: the Better Auth rate limit on `/sign-in/email`, which
[ADR-0039](./0039-sign-in-limits-are-sized-for-a-shared-address.md) left at the
framework default purely because `emailVerification.sendOnSignIn` turned that
number into the ceiling on verification mail aimed at a stranger's inbox. That
was the wrong shape twice over. It keys on the sender's address, which says
nothing about whose inbox is filling up, and campus NAT makes a per-address
number meaningless anyway, which is the same conclusion ADR-0039 reached about
protecting a credential. Counting per recipient measures the thing being harmed.
Three an hour is sized against the honest person rather than the attacker,
because this is the one control here that can lock somebody out of their own
account: their worst legitimate hour is the link sign-up mailed them, a second
from the sign-in that refuses them once the first expired, and a third after a
mistype, and a fourth in the same hour means the mail is not arriving at all,
which another copy does not fix. The counter fails OPEN, which is the opposite
of how a cap usually fails and is deliberate. Everything it gates is somebody's
only way into their own account, and both callers run after Better Auth has
already read the user out of the database, so a counter that cannot answer means
a transient blip rather than a database that is down; refusing mail through one
would lock out every new account for its duration, and letting an amplifier run
for that window is the smaller harm. The same argument `swallowing` makes for
the sign-in counter. Decided 2026-09-21 in #554.

## Consequences

`/sign-in/email` is no longer doing double duty, so #552 may raise it on its own
merits; this change does not, and ADR-0039 is still where the argument for that
number lives. The check and the insert are two statements, so two requests in
the same millisecond can both pass at a count of two and send a fourth message;
that is accepted, because this bounds an amplifier rather than guarding a
credential, and `sign_in_attempts` has the same shape for the same reason. The
table holds an address and a timestamp, which is the pair
[ADR-0036](./0036-access-logs-keep-raw-addresses-for-thirty-days.md) and #513
already cover, and rows are pruned per recipient by the writer rather than by a
scheduled sweep, so rows for an address that never appears again are left
behind. A refused send is a silent skip and a `console.warn` carrying no
address, never an `APIError`: sign-up and the refused sign-in still answer
exactly as they did, because neither should fail over a message that was not
sent. `VERIFICATION_MAIL_LIMIT` and `VERIFICATION_MAIL_WINDOW_MINUTES` are
plumbed through `infra/ecs.tf` so the numbers can be retuned without a deploy,
and a zero or a typo falls back to the default rather than refusing every
verification link on the app. The cap is what makes recording a completed
password reset as proof of the address load-bearing rather than tidy: without
that, the fourth message in an hour to a squatted address is the one the real
owner needs after resetting, and this would refuse it.
