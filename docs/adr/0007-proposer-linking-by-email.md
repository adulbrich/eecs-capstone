# Proposers link by email, `proposer_id` is canonical, and only a verified address claims

Amended on 2026-09-22 by [#576](https://github.com/adulbrich/eecs-capstone/issues/576): the verification hook on the password path is gone. A project is now claimed by the create hook, which a code sign-up and OAuth both reach with the address already proved, by a redeemed code on a row that existed unverified, and by ONID taking an address off an unproven row ([ADR-0045](./0045-onid-takes-an-address-off-an-unproven-account.md)). The rule is unchanged: only proof of the address claims.

A project's proposer is an account id when one exists and an email address until then. Email is the link key because staff propose projects for people who have not signed up; the id is the source of truth once they have, resolved from the address on every write and never accepted from the client. A project left unlinked is claimed when an account verifies that address, from the verification hook on the password path and the create hook on OAuth, and from nowhere else: claiming on registration alone would let anyone take a colleague's projects by signing up at their address.

## Consequences

Any third claim path has to name the proof of ownership it relies on. Deleting an account keeps `proposer_id` set on its projects, which is what stops a re-registered address reclaiming them. The proposer email is private to staff and is not the public contact address.
