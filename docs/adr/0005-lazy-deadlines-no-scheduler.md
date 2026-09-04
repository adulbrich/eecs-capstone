# Deadlines are informational and overdue is derived; there is no scheduler

Pickup and due dates on request lines and on items are columns nothing acts on. Overdue is computed from them and the clock by `src/lib/inventory-deadlines.ts` whenever something asks, so the page a student lands on and the notification scan cannot disagree about what overdue means. Overdue notifications are written lazily on read, idempotently, deduplicated on `(user_id, type, link)` by a partial unique index, so a re-read repeats nothing and the app runs with no cron, no queue and no second process to deploy.

## Consequences

An overdue notice arrives when someone next opens the page that scans, not at the moment the deadline passes. A hold on an address with no account cannot be notified until staff link it, because a notification needs an account to attach to. The analytics dashboard's overdue count is the one sanctioned SQL twin of the rule, pinned by a test that seeds one of each case.
