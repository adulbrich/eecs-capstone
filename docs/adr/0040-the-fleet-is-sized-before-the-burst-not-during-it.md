# The fleet is sized before the burst, not during it

`app_min_tasks` in `infra/variables.tf` goes from 2 to 3; `app_max_tasks` stays
at 4 and the target tracking policy is left exactly as
[ADR-0035](./0035-scale-the-service-and-let-it-pick-the-instance.md) set it,
because the policy is not what is wrong. The #524 load test measured two tasks
absorbing 26.3 requests per second while a 500 student term start needs about
42, at a measured cost of roughly 19 ms of vCPU per listing render, so two
tasks cannot serve the arrival however well the scaler behaves, and three at
about 39 are the cheapest floor that comes within reach of it while leaving the
scaler a fourth task to add. Read 39 as what three tasks absorb at saturation
rather than as comfortable capacity, since the 26.3 it scales from was measured
at a p50 of 4.12 seconds. The reason the floor rather than the policy is
that scaling out is measurably slower than the burst it would have to answer,
and this is now measured rather than predicted: the alarm went to ALARM 2
minutes 43 seconds after the third consecutive breaching minute closed, and the
new tasks were serving 3 minutes 22 seconds after it, against a term start
burst that lasts about two, by which time the load had been over for three
minutes and the scaler wound them straight back down. The minute by minute
timeline is in `docs/load-tests/2026-09-20-term-start.md` and is not repeated
here. #546 records that autoscaling "never fired" and that the alarm never
transitioned, and the write-up said the same; both were artifacts of reading
`runningCount` and the scaling activity list before the scaler acted, the
write-up is corrected in place, and this ADR with the pull request carrying it
is the correction to the issue. The alarm is healthy, the policy sized the jump
correctly when it finally saw the data, and neither fact helps: a mechanism
needing three consecutive breaching minutes on a metric ECS published about two
and a half minutes late cannot answer a two minute arrival, so the tasks have
to be running beforehand. One non-breaching minute resets that run of three,
which is what the gap between two test phases did, so the measured lag is a
floor rather than a typical case. Scheduled scaling that lifts the floor to four for the first
week of term and drops it back after was priced against this and not taken: a
week of a fourth task is about $2 against the $8.51 a month a permanent fourth
costs, so the saving is real but small, and it is bought by adding a moving
part whose failure mode is silently not firing on the one morning it exists
for. Decided 2026-09-21, with the floor and the
cost confirmed by the maintainer, the same way ADR-0035's were.

## Consequences

Recurring cost goes up by about $8.51 a month, the price of the third always-on
task at 0.25 vCPU and 1024 MB on Fargate ARM64. `terraform apply` adds the task
as soon as it runs rather than at the next deploy, because `min_capacity` reads
`app_min_tasks` directly and Application Auto Scaling raises the desired count
to a new floor immediately, which is what it did on 2026-09-20 at 19:24. The
connection budget is untouched: `CONNECTION_BUDGET.taskCeiling` is twice
`app_max_tasks` and the ceiling did not move, so `src/lib/__tests__/db-pool.test.ts`
still holds, and three tasks at the pool maximum of 20 are 60 of the instance's
220 rather than the 40 the load test watched pin. That sentence describes the
budget as it stood on 2026-09-21; [ADR-0043](./0043-a-deploy-dips-rather-than-doubles.md)
then dropped the doubling and the ceiling is `app_max_tasks` itself. The scaling signal stays CPU, which settles
the question ADR-0035 left open: it asked whether memory would turn out to lead
CPU under real concurrency, in which case the CPU policy would not fire when it
mattered. It does not. Across the loaded phases the fleet average CPU
peaked at 99.7% while memory peaked at 23.2% of 1024 MB, so CPU leads by a wide
margin and the memory
raise to 1024 was the right answer to memory rather than a scaling signal. The
burst is still not fully covered: three tasks are about 39 requests per second against about 42, so a
term start arrival will still saturate briefly and the fourth task will still
arrive minutes late, which is accepted for now rather than fixed, and the thing
that would fix it is a floor of 4 for the arrival window. What would change
this decision is a measurement rather than an argument: a phase 1c and phase 2
re-run against a three task fleet, after [ADR-0041](./0041-the-task-outlasts-the-load-balancer-idle-timeout.md)
deploys, since those phases must not run until the 502 fix is live.
