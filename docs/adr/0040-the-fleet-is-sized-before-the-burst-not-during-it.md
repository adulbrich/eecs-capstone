# The fleet is sized before the burst, not during it

`app_min_tasks` in `infra/variables.tf` goes from 2 to 3; `app_max_tasks` stays
at 4 and the target tracking policy is left exactly as
[ADR-0035](./0035-scale-the-service-and-let-it-pick-the-instance.md) set it,
because the policy is not what is wrong. The #524 load test measured two tasks
absorbing 26.3 requests per second while a 500 student term start needs about
42, at a measured cost of roughly 19 ms of vCPU per listing render, so two
tasks cannot serve the arrival however well the scaler behaves, and three at
about 39 are the cheapest floor that comes within reach of it while leaving the
scaler a fourth task to add. The reason the floor rather than the policy is
that scaling out is measurably slower than the burst it would have to answer,
and this is now measured rather than predicted: on 2026-09-21 the CPU average
breached 50% at 06:36 and 06:37, dipped to 13.6% at 06:38 in the gap between
two test phases, and breached again at 06:39, 06:40 and 06:41 at 72.8, 85.9 and
82.0 percent, which is the first run of three consecutive minutes the alarm's
three evaluation periods can fire on; `AlarmHigh` went to ALARM at 06:44:43 and
set the desired count to 4, and the two new tasks logged themselves listening
at 06:45:13 and 06:45:22. The third breaching datapoint is stamped 06:41 and
covers the minute ending 06:42, so that is 2 minutes 43 seconds from its close
to the alarm firing and 3 minutes 22 seconds to capacity actually serving,
against a term start burst that lasts about two; the load had stopped at 06:42,
so the tasks arrived three and a half minutes after the last request and the scaler wound them back down at
06:59 and 07:10. #546 and the load test write-up both record that autoscaling
"never fired" and that the last scaling activity predated the run; that was an
artifact of reading `runningCount` and the activity list before 06:44:43, and
it is corrected in both places. The alarm is healthy, the policy sized the
jump correctly when it finally saw the data, and neither fact helps: a
mechanism that needs three consecutive breaching minutes on a metric ECS
publishes late cannot answer a two minute arrival, so the tasks have to be
running beforehand. Scheduled scaling that lifts the floor for the first week
of term and drops it after was priced against this and not taken, because it
buys about $8.51 a month against a term that lasts weeks and adds a moving part
that fails silently by not firing. Decided 2026-09-21, with the floor and the
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
220 rather than the 40 the load test watched pin. The scaling signal stays CPU, which settles
the question ADR-0035 left open: it asked whether memory would turn out to lead
CPU under real concurrency, in which case the CPU policy would not fire when it
mattered. It does not. Under the burst that pinned one task at 99.9% CPU,
memory reached 23.2% of 1024 MB, so CPU leads by a wide margin and the memory
raise to 1024 was the right answer to memory rather than a scaling signal. The
burst is still not fully covered: three tasks are about 39 requests per second against about 42, so a
term start arrival will still saturate briefly and the fourth task will still
arrive minutes late, which is accepted for now rather than fixed, and the thing
that would fix it is a floor of 4 for the arrival window. What would change
this decision is a measurement rather than an argument: a phase 1c and phase 2
re-run against a three task fleet, after [ADR-0039](./0039-the-task-outlasts-the-load-balancer-idle-timeout.md)
deploys, since those phases must not run until the 502 fix is live.
