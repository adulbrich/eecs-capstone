# A deploy dips rather than doubles, so the pool can be deep

`infra/ecs.tf` sets `deployment_maximum_percent` to 100 and
`deployment_minimum_healthy_percent` to 50 on the app service, and
`src/lib/_internal/db-pool.ts` moves `taskCeiling` from 8 to 4 and the pool
from 20 connections per task to 45. The #524 load test on 2026-09-21 found
that the connection pool, not CPU, is what fails under a term start burst:
three tasks pinned RDS `DatabaseConnections` at 59 of 60 while CPU peaked at
98% and served everything, and Better Auth session lookups failed on
[ADR-0034](./0034-the-pool-is-sized-against-the-instance.md)'s 5 second
acquire timeout, which hits signed-in users and which an anonymous load test
cannot see (#558). The budget had no room to raise the pool, and the reason
was the deploy rather than the instance: at the AWS default of 200 percent a
deploy runs old and new tasks side by side, so the worst case is twice
`app_max_tasks`, eight tasks, and `(20 + 5) * 8 + 10` is already 210 of the
instance's 220. Nothing about serving needs that doubling. Capping a deploy
at the desired count makes the worst case `app_max_tasks` itself, and
`(45 + 5) * 4 + 10 = 210` fits the same instance with the same ten spare.
The trade is deploy-time capacity: at 100 percent ECS stops a task before it
starts its replacement, so a fleet of three dips to two for the length of a
health check per task, which the 2026-09-20 run measured at about 26
requests per second against a term start burst of about 42. That is accepted
because a deploy is a thing an operator starts, and the arrival window is a
few minutes on a known morning, while the pool ceiling would have bound every
burst whether or not anyone was deploying. Raising the pool in step with the
ceiling rather than leaving 20 in place is deliberate: the ceiling change
buys nothing on its own, and the load test measured the pool as the
constraint. Deploys also take longer, since the three replacements happen in
sequence rather than at once. The larger lever #558 names, a bigger
instance, was not taken because RDS CPU peaked at 13.3% and the credit
balance rose across the sitting; the database is idle and a larger class
buys memory to hold idle sockets. Decided 2026-09-22.

## Consequences

`src/lib/__tests__/db-pool.test.ts` now reads `deployment_maximum_percent`
out of `infra/ecs.tf` beside `app_max_tasks` out of `infra/variables.tf`, so
the task ceiling is derived from both writings and a change to either fails
the test rather than silently overrunning the instance. Do not deploy during
the first hour of a term start morning, or during any announced arrival; the
dip is half the fleet, and nothing stops the workflow running. Autoscaling
can still raise the desired count to four during a deploy, and the ceiling
counts that, so a scale-out mid-deploy is inside the budget. `terraform
apply` changes the service in place and needs no deploy to take effect, but
the pool number is in application code, so the deeper pool arrives with the
next deploy, and the two are safe in either order: a 45 pool on a 200
percent deploy is a worst case of 410 and would exceed the instance, which
is why the apply should go first, and the test is what holds the order the
next time either number moves. The honest signal is the same one ADR-0034
named: the hourly `DatabaseConnections` maximum, which should now stay well
under 135 on three tasks. What this does not do is cut demand; #558's other
two halves, caching the listing's two reference tables and measuring acquire
wait, stand, and the pool metric is the deliberate replacement for the
session-lookup failures that ADR-0042's redaction now makes harder to notice.
