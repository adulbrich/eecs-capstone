# Triage labels

The engineering skills speak in five canonical triage roles. This repo uses the same
strings, so the mapping is the identity. Every triaged issue carries one category
label, one state label, and usually one priority label.

| Role (skills)     | Label here        | Meaning                                                            |
| ----------------- | ----------------- | ------------------------------------------------------------------ |
| `needs-triage`    | `needs-triage`    | Awaiting evaluation. Where an untriaged issue lands first.         |
| `needs-info`      | `needs-info`      | Waiting on the reporter. Returns to `needs-triage` when they reply. |
| `ready-for-agent` | `ready-for-agent` | Fully specified with an agent brief attached. An AFK agent can take it. |
| `ready-for-human` | `ready-for-human` | Briefed, but needs judgment, external access, or manual testing.   |
| `wontfix`         | `wontfix`         | Will not be actioned. Closed with the reason.                      |

Category labels are GitHub's `bug` and `enhancement`, plus `documentation`.

## Priority

Beside the state, a priority label says when. `/triage` and `/to-tickets` leave it
to the maintainer unless told otherwise.

| Label      | Meaning                                |
| ---------- | -------------------------------------- |
| `p0-now`   | Doing this now, blocks other work      |
| `p1-next`  | The next thing to pick up              |
| `p2-later` | Real, but not scheduled                |

## The queue

`ready-for-agent` sorted by priority is what an agent session picks from. Claim by
assigning yourself before the first edit, so a concurrent session skips it.
