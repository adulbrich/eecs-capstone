# Sign-in is proved by an emailed code, not a magic link

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
It is higher than the other two kinds because it is sized from the opposite
direction: those cap mail about an address whose owner has another way in, and
this one caps the way in itself, so running out locks somebody out of the app.
Per-address rate limiting cannot do this job, for the reason
[ADR-0039](./0039-sign-in-limits-are-sized-for-a-shared-address.md) gives, that
campus NAT makes the sender's address meaningless. That is also why
`/sign-in/email-otp` is given the unchecked per-address number rather than the
plugin's three: the guess budget does not depend on it, so the only thing the
number decides is whether a shared campus address can type a code.

Six of the nine paths the plugin mounts are refused through `disabledPaths`, and
one of them had to be. `/email-otp/verify-email` flips `emailVerified` on an
address that presents a valid code without first calling
`revokeUnprovenAccountAccess`, so while password sign-up still exists it is
[#575](https://github.com/adulbrich/eecs-capstone/issues/575) through a new
door: a squatter registers an address, its real owner asks for a code and
redeems it there, and the owner has verified a row whose password the squatter
chose. `/sign-in/email-otp` is the only path that revokes first, so it is the
only one allowed to verify. The password-reset and email-change paths go for a
duller reason, that this app has its own flows and a second set of endpoints
reaching the same columns is surface with no caller.

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

What this accepts is a hard dependency on mail delivery. Today a password works
even when SES is degraded; after this, and more so once password sign-in is
removed, an outage in mail is an outage in sign-in for everyone without ONID.
The exposure grows rather than appears, because every account already passes
through a mailed verification link, but it grows. ONID is unaffected and carries
about three quarters of sign-in traffic already, measured from the ALB access
logs on 2026-09-22, so the population exposed to it is staff, mentors and
industry partners rather than students.
