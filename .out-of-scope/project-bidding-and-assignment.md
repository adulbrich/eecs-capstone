# Project bidding and assignment

**Decision:** Students do not bid on projects in the app, and the server stores no
bid, placement or record of who joined a team.

**Reason:** Each course section runs bidding its own way, in its own survey, so one
in-app bidding form would not fit them all, and bookmarks already cover the part of
the need that is a student keeping a list. What sections share is the step after
the survey, placing students on teams, and that step is built (#644): a staff tool
that takes the survey's export as a file and solves the placement in the staff
member's browser, so bids never reach the server
([ADR-0056](../docs/adr/0056-placement-runs-in-the-browser.md)). The
`project_bids` and `project_assignments` tables from the original scaffold go in
#646. The `accepting_applicants` flag stays the one thing the server records about
applicants: whether a project is taking them, never who they are.

**Prior requests:** #33
