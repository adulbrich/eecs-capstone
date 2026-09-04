# Proposers link by email, `proposer_id` is canonical, and only a verified address claims

A project's proposer is an account id when one exists and an email address until then. Email is the link key because staff propose projects for people who have not signed up; the id is the source of truth once they have, resolved from the address on every write and never accepted from the client. A project left unlinked is claimed when an account verifies that address, from the verification hook on the password path and the create hook on OAuth, and from nowhere else: claiming on registration alone would let anyone take a colleague's projects by signing up at their address.

## Consequences

Any third claim path has to name the proof of ownership it relies on. Deleting an account keeps `proposer_id` set on its projects, which is what stops a re-registered address reclaiming them. The proposer email is private to staff and is not the public contact address.
