# Sign-in is proved by an emailed code, not a magic link

Amended on 2026-09-22 by [#576](https://github.com/adulbrich/eecs-capstone/issues/576): password sign-in is gone. The closing paragraph says what that changes about the price below.

Amended on 2026-09-23 by [#584](https://github.com/adulbrich/eecs-capstone/issues/584) and [#605](https://github.com/adulbrich/eecs-capstone/issues/605): the code guard fails CLOSED. If its reads throw, the guess is refused with `INVALID_OTP` and the person asks for a new code. It used to fail open, borrowing the send cap's reasoning from [ADR-0046](./0046-mail-about-an-address-is-capped-per-recipient.md), and that reasoning does not transfer: the cap gates a send, somebody's only way to get a code at all, while the guard gates one guess at a code already sent, and failing open let a redeem verify a row another provider is linked to with nothing behind it. The send cap still fails open. The two row refusals are now `addressProofRefused` in `src/lib/address-proof.ts`, shared with the ONID release and the admin user page, and a banned row is refused only while the ban is active, the same test the admin plugin applies.

Better Auth's `emailOTP` plugin mails a six digit code that the person types
back into the tab they started in, and `magicLink` mails a URL they click. The
two have the same security property, that no `user` row exists until the address
is proved, and this app takes the code. The deciding difference is where the
second step happens. A link opens in whatever browser the mail client picks,
which on a phone is not the desktop session that began the sign-in, so a
population that starts on a lab machine and reads mail on a phone lands signed
in somewhere they were not working. A code crosses that gap by being read rather
than followed. It also degrades better when a message is forwarded: a forwarded
link is a working session for whoever opens it, while a forwarded code is
useless without the tab it belongs to, and reads as a secret in a way a URL does
not. Against that, a code is six digits rather than 32 characters, which is why
`allowedAttempts` and the per-recipient send cap below are load-bearing rather
than decoration. Decided 2026-09-22 in #576.

The code is stored encrypted rather than hashed, which inverts the usual
preference and is right for this input. `storeOTP: "hashed"` is an unsalted
SHA-256, and over a six digit space a hash is not a one-way function: a table of
a million preimages reverses every row in the `verification` table at once.
`storeOTP: "encrypted"` is `symmetricEncrypt` under the Better Auth secret,
which does not live in the database, so a database leak alone yields nothing. It
also leaves `resendStrategy: "reuse"` available, which hashing forecloses.

The per-recipient send cap is the brute force control, not politeness.
`allowedAttempts` bounds one code at three guesses counted on its verification
record, but the default `resendStrategy: "rotate"` writes a fresh record with
the count back at zero, so an attacker who can ask for unlimited codes has
unlimited guesses. `SIGN_IN_CODE_LIMIT`, a third kind in
[ADR-0046](./0046-mail-about-an-address-is-capped-per-recipient.md)'s
`verification_sends`, is what bounds the resends, at five an hour per recipient.
It was set higher than the other two kinds, verification links and
duplicate-sign-up notices, because it is sized from the opposite direction:
those capped mail about an address whose owner had another way in, and this one
caps the way in itself, so running out locks somebody out of the app. Those two
kinds went with the password in #576.
Per-address rate limiting cannot do this job, for the reason
[ADR-0039](./0039-sign-in-limits-are-sized-for-a-shared-address.md) gives, that
campus NAT makes the sender's address meaningless. That is also why
`/sign-in/email-otp` is given the unchecked per-address number rather than the
plugin's three: the guess budget does not depend on it, so the only thing the
number decides is whether a shared campus address can type a code.

The attempt counter that bounds guessing is also a way to lock somebody out, and
that is the sharpest cost of choosing a code over a link. `atomicVerifyOTP`
counts attempts on the verification record, which is keyed on the address alone
and on nothing about who is asking, and its own docstring says a record whose
attempts are exhausted is "left consumed (no recreate), locking the identifier
out". So anyone who knows an address can post three wrong codes to
`/sign-in/email-otp` inside the five minute window and destroy the code its owner
is holding, repeatedly, faster than `SIGN_IN_CODE_LIMIT` lets the owner ask for
another. It is not the check endpoint that opens this and disabling that endpoint
would not close it. Rate limiting does not close it either: three requests is
cheap from one address and cheaper from several, and the number here has to stay
high enough that a shared campus address can type a code.

A magic link has no equivalent, because a 32 character token needs no attempt
counter, which is a point for the link that the comparison above does not make.
It was not enough to reverse the choice, because the cross-device failure is
certain and affects everyone while this needs a motivated attacker, and the class
is closed instead by a claim: `src/lib/otp-claim.ts` and the two guards in
`src/lib/auth.ts` (#581).

The claim gates the REDEEM and not the send, and the asymmetry is the whole
design, so it is worth saying why the symmetric version is wrong. Gating the send
too, on the rule that a live code belongs to the browser that asked for it, reads
like the stronger rule and was the first implementation. It is worse than doing
nothing. Nobody can prove they own an address at send time, so a stranger who
asks FIRST takes the claim on a code that is mailed to somebody else: the owner's
correct code is then refused, and their own resend is swallowed by the same rule,
so one unauthenticated request denies them sign-in for the life of the code.
That is cheaper than the three-guess burn it was written to prevent. Review pass
3 on #580 caught it.

With the send left open, a stranger asking for a code rotates the record and
mails the owner the new one. The owner cannot redeem that code, because its claim
went to the stranger's browser; an earlier draft said they could read the newest
message and was wrong (review pass 2 on #576). What they can do, while they
have a send left in the hour, is ask again, which rotates the record once more
and hands their own browser the claim.

**What this buys is a price, not a closure, and the difference is worth stating
plainly because the first draft of this paragraph got it wrong.** A stranger who
asks for a code is handed a claim on the record their own ask created, and can
spend that record's three guesses. So a code can still be burned. What it costs
them is one of the recipient's five sends an hour, where before it cost three
POSTs, no send, and nothing from any budget. Exhausting those five sends already
denies somebody their own mail, and
[ADR-0046](./0046-mail-about-an-address-is-capped-per-recipient.md) accepted that
denial before any of this existed, so the attack is now no cheaper than one the
app had already priced in. That is the whole of the guarantee: **a stranger
cannot spend a guess without first spending a send.**

Closing it completely needs what this design does not have, one live code per
browser rather than one per address. Better Auth keys the record on the address
alone, so that means owning the send and verify paths rather than calling them.
Not worth it for the margin between "costs a send" and "costs nothing", which is
the margin left.

The claim is an HMAC over the address and the record's expiry under the Better
Auth secret, so nothing is stored and a rotation invalidates the previous
browser's claim by moving the expiry. The secret is not in the database, so
reading `verification` yields no claim to the code in it.

One cost, accepted: a browser that loses the cookie cannot redeem the code it was
sent, and has to ask again. Asking again works while a send is left in the hour,
which is what makes that bearable rather than a lockout.

One implementation note that is easy to get backwards. The per-recipient cap is
spent in the `hooks.before` on the send, NOT inside `sendVerificationOTP`,
because `resolveOTP` writes the rotated record before the sender runs. Refusing
in the sender left the record holding a code nobody had been told, so a sixth
request in an hour did not merely fail to mail: it killed the code the person was
already holding.

Six of the nine paths the plugin mounts are refused through `disabledPaths`, and
one of them had to be. `/email-otp/verify-email` flips `emailVerified` on an
address that presents a valid code without first calling
`revokeUnprovenAccountAccess`, so on a row a squatter registered with a
password it is [#575](https://github.com/adulbrich/eecs-capstone/issues/575)
through a new door: its real owner asks for a code and redeems it there, and the
owner has verified a row whose password the squatter chose. Nobody can register
one since #576, but production still holds the rows made before.
`/sign-in/email-otp` is the only path that revokes first, so it is the only one
allowed to verify. The password-reset and email-change paths go for a duller
reason: nothing in this app calls them, and a set of endpoints reaching the
same columns with no caller is surface for nothing.

Two refusals are added ahead of the plugin, in
`src/server/_internal/otp-sign-in-guard.ts`, because Better Auth's
`revokeUnprovenAccountAccess` is looser than the
[ADR-0045](./0045-onid-takes-an-address-off-an-unproven-account.md) helper it
was modelled on. A banned row: the admin plugin checks the ban in
`databaseHooks.session.create.before`, which runs after the credential and the
sessions have been deleted, so a code sign-in against a banned unverified row
fails and still strips it, quietly rewriting a decision an admin made. A row
another provider is linked to: the helper deletes only `credential` accounts, so
it deletes nothing there, and the sign-in then verifies the row and mints a
session while the provider identity keeps working, leaving one row answering to
two people. Proving an address proves the address and says nothing about the
other identity on it. Both refusals return `INVALID_OTP`, byte for byte what a
wrong guess returns, because the guard runs before any code has been offered and
a distinct refusal would answer "is there a banned or socially linked row at
this address" to anyone who asked. The cost is that the two small populations it
turns away get no explanation, and both have a person to talk to.

What this accepts is a hard dependency on mail delivery. A password used to work
even when SES was degraded; since #576 removed it, an outage in mail is an outage
in sign-in for everyone without ONID or GitHub. The exposure grew rather than
appeared, because every account already passed through a mailed verification
link, but it grew. ONID is unaffected and carries
about three quarters of sign-in traffic already, measured from the ALB access
logs on 2026-09-22, so the population exposed to it is staff, mentors and
industry partners rather than students.

Password sign-in was removed on 2026-09-22 in #576, which changes the weight of
the price above without changing the decision. A stranger who asks for a code
can still spend its three guesses, at the cost of one of the recipient's sends,
and that was bearable partly because the person whose code was burned still had
a password. They no longer do, unless they have ONID or GitHub, so what the
attack denies is sign-in itself rather than one route to it, for as long as the
attacker keeps paying sends. The population exposed is the one without ONID:
staff, mentors and industry partners. Closing it is still the margin described
above, one live code per browser, and it was left out of #576 deliberately.
