# Project bidding and assignment

**Decision:** The app does not model students bidding on projects or staff
assigning students to them.

**Reason:** Each course section assigns students its own way, so one model would
not fit them all, and the sections that want tooling can feed their own from the
admin CSV export, which carries every public project field. Bookmarks already cover
the part of the need that is a student keeping a list. The `project_bids` and
`project_assignments` tables exist from the original scaffold with no UI or server
logic; #33 said they should go with the feature, and they have not yet. The
`accepting_applicants` flag is the one thing the app records about applicants:
whether a project is taking them, never who they are.

**Prior requests:** #33
