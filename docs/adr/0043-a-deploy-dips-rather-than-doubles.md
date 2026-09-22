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
starts its replacement, and a stopping task counts against the ceiling until
it has drained, so a fleet of three dips to two while the old task drains,
the new one starts and two health checks pass, which is about three minutes
per task and three tasks in sequence. Two tasks is what the 2026-09-20 run
measured at about 26 requests per second against a term start burst of about
42. That is accepted because a deploy is a thing an operator starts, and the
arrival window is a few minutes on a known morning, while the pool ceiling
would have bound every burst whether or not anyone was deploying. The drain
is the part that had to move for this to be workable at all: the target
group's `deregistration_delay` was the AWS default of 300 seconds, which
would have put three sequential replacements past the deploy workflow's ten
minute wait, so it is now 60 seconds, the load balancer's own idle timeout:
far above the slowest response the load test recorded (4.3 s), and sized for
the one request that can legitimately run long, a 10 MB image upload on a
slow link, which the anonymous load test never sent. The workflow retries
its wait rather than calling a slow rollout a failure. Raising the pool in step with the ceiling rather than
leaving 20 in place is deliberate: the ceiling change buys nothing on its
own, and the load test measured the pool as the constraint. This is the
lever #558 called the larger one and left to the maintainer; the bigger
instance it rules out stays ruled out, because RDS CPU peaked at 13.3% and
the credit balance rose across the sitting, so a larger class would buy
memory to hold idle sockets. Chosen by the maintainer on 2026-09-21.

## Consequences

`src/lib/__tests__/db-pool.test.ts` now reads `deployment_maximum_percent`
out of `infra/ecs.tf` beside `app_max_tasks` out of `infra/variables.tf`, so
the task ceiling is derived from both writings and a change to either fails
the test rather than silently overrunning the instance. Do not deploy during
the first hour of a term start morning, or during any announced arrival; the
dip is half the fleet, and nothing stops the workflow running. Autoscaling
can still raise the desired count to four during a deploy, and the ceiling
counts that, so a scale-out mid-deploy is inside the budget. The order of rollout is a human step and nothing in the repo enforces it:
`terraform apply` first, then the deploy. The apply changes the service in
place and takes effect on the next deploy; the pool number is application
code and arrives with that deploy. Deploying first is unsafe on the very
first mixed rollout, not only in the worst case: three old tasks at 20 beside
three new at 45, with the traffic writer's reservation and the one-off
script, is `(20 + 5) * 3 + (45 + 5) * 3 + 10 = 235` against 220. The test
keeps the two repo numbers consistent with each other; it cannot see what is
applied in AWS. The honest signal is the same one ADR-0034
named: the hourly `DatabaseConnections` maximum, which should now stay well
under 135 on three tasks. What this does not do is cut demand; #558's other
two halves, caching the listing's two reference tables and measuring acquire
wait, stand, and the pool metric is the deliberate replacement for the
session-lookup failures that ADR-0042's redaction now makes harder to notice.
