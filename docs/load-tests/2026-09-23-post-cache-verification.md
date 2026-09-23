# Load test: after the listing cache and the deeper pool, 2026-09-23

Run from a laptop in Corvallis against production, 2026-09-23 from 07:12 to 07:37 UTC
(00:12 to 00:37 PDT), with background traffic at about 0.8 requests per second. Script:
[`scripts/loadtest/projects-browse.js`](../../scripts/loadtest/projects-browse.js), unchanged.
Method and warnings are in [`2026-09-20-term-start.md`](./2026-09-20-term-start.md). This run
answers the question [`2026-09-21-post-fix-verification.md`](./2026-09-21-post-fix-verification.md)
left for [#558](https://github.com/adulbrich/eecs-capstone/issues/558): with the pool at 45
per task (#570, ADR-0043) and the listing's filter options cached per task (#596,
ADR-0051), does the pool still run out, and were the phase 2 latency misses the pool?

**The pool no longer runs out, and the burst's tail latency halved.** `PoolWaiting` read 0 in
every minute of every phase. `DatabaseConnections` peaked at 25 during the 42 requests per
second burst, against 59 of 60 on 2026-09-21. On the warm fleet the burst's p95 fell from
1.01 s to 520 ms and its p99 from 1.99 s to 846 ms, with zero 5XX, though on four tasks
where the earlier run had three. What limits the fleet now is task CPU.

**The first burst aborted on one 500, from a task that autoscaling had added 72 seconds
earlier.** That is a new failure and has its own issue,
[#601](https://github.com/adulbrich/eecs-capstone/issues/601). The 500 left no line in the
task log, which is [#602](https://github.com/adulbrich/eecs-capstone/issues/602).

The comparison is not like for like, and the difference matters. Phase 1c scaled the fleet
from three tasks to four, so both burst attempts ran on four tasks where 2026-09-21 had
three. See "Four tasks, not three" below before quoting the burst numbers against the
earlier run.

## Configuration under test

| | At the time of this run |
| --- | --- |
| Tasks | 3 at the start, 4 from 07:18; autoscaling 3 to 4 on 50% average CPU (ADR-0040) |
| Task size | 256 CPU units (0.25 vCPU), 1024 MB, Fargate ARM64 |
| Database | `db.t4g.small`, `CPUCreditBalance` 576 |
| Pool | 45 connections per task, 5 s acquire timeout (ADR-0034, ADR-0043) |
| Listing | filter options cached per task for 60 s (ADR-0051); the search itself is not cached |
| Deploy | task definition revision 88, rollout completed 07:02:33 |
| Baseline | zero ELB 5XX and zero target 5XX in the preceding 3 hours |

The deploy finished ten minutes before the first phase. Phase 1c waited until the
youngest task was ten minutes old, because the 2026-09-21 run lost its first attempt to
warm-up at seven.

## Results

| Phase | Rate | Tasks | p50 | p95 | p99 | max | Absorbed | Dropped | Target 5XX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1c | 25/s, 3m | 3 | 67 ms | 356 ms | 786 ms | 3.80 s | 24.3/s | 0 | 0 |
| 2. Burst, first | 42/s, aborted at 17 s | 4, one cold | 171 ms | 1.58 s | 3.76 s | 5.92 s | 35.3/s | n/a | **1** |
| 2. Burst | 42/s, 90s | 4 | 92 ms | 520 ms | 846 ms | 2.66 s | 39.7/s | 0 | 0 |
| 2. Tail | 8/s, 10m | 4 | 60 ms | 138 ms | 198 ms | 669 ms | 7.9/s | 0 | 0 |

Every completed phase passed every check: 9000, 7560 and 9608 of them, every response a
200 and an origin miss. ELB 5XX was zero throughout.

The highest one minute datapoint inside each phase:

| Phase | `PoolWaiting` | `PoolTotal` per task | `DatabaseConnections` | Task CPU avg / max | RDS CPU | Memory |
| --- | --- | --- | --- | --- | --- | --- |
| 1c | 0 | 11 | 17 | 60.5% / 96.2% | 9.1% | 20.8% |
| 2. Burst, first | 0 | 31 | n/a, 17 s | n/a, 17 s | n/a | 20.6% |
| 2. Burst | 0 | 11 | 25 | 71.3% / 94.3% | 12.1% | 21.3% |
| 2. Tail | 0 | 2 | 9 | 16.3% / 23.2% | 6.4% | 21.7% |

`PoolWaiting` is the metric #558 added: pg-pool's `waitingCount`, sampled every second,
the maximum across tasks per minute. Zero means no request queued for a connection in any
second of any phase.

Against 2026-09-21, on the same script and the same rates:

| | 2026-09-21, 3 tasks, pool 20 | 2026-09-23, pool 45 and the cache |
| --- | --- | --- |
| 1c p50 / p95 / p99 | 41 ms / 287 ms / 661 ms | 67 ms / 356 ms / 786 ms (3 tasks) |
| Burst p50 / p95 / p99 | 151 ms / 1.01 s / 1.99 s | 92 ms / 520 ms / 846 ms (4 tasks) |
| Burst absorbed | 39.6/s, 2 dropped | 39.7/s, 0 dropped |
| `DatabaseConnections` peak | 59 of 60 | 25 of 180 |
| Session lookups failing on acquire | yes, at 21:53:05 | no failed query in the log, 07:10 to 07:40 |

Phase 1c on three tasks was a little slower than on 2026-09-21, not faster. Neither run
queued on the pool at 25 requests per second, so the pool change should not show there;
the difference is within what a different set of tasks, ten minutes old instead of seven,
and a different minute of background traffic can produce, and this run cannot separate
those.

## Against #524's own success criteria

On the warm burst, five of the six hold and the sixth misses by 20 ms.

| #524 criterion at 42 requests per second | 2026-09-21 | 2026-09-23 | |
| --- | --- | --- | --- |
| p95 under 500 ms | 1.01 s | 520 ms | **miss, by 20 ms** |
| p99 under 1500 ms | 1.99 s | 846 ms | pass |
| Zero 5XX | 0 | 0 warm, 1 on the cold attempt | pass warm, see #601 |
| `DatabaseConnections` stays below the pool maximum | 59 of 60 | 25 of 180 | pass |
| ECS `MemoryUtilization` under 75% | 23.8% | 21.3% | pass |
| `runningCount` never drops | held at 3 | held at 4 | pass |

The remaining p95 gap is CPU, not the pool: one task reached 94% while `PoolWaiting`
stayed at 0 and RDS sat at 12%. On three tasks the gap would be wider. The measurement
that would settle it is the burst on three warm tasks, which this run did not get because
autoscaling had already added the fourth.

## Four tasks, not three

Phase 1c held the fleet at 51 to 60% average CPU for three minutes, which is what
target tracking at 50% needs, and it launched a fourth task at 07:17:46. ADR-0040 sized the
floor so that a burst would not depend on this, and on 2026-09-21 the same phase did not
trigger it: 1c averaged 61.3% there too, so whether it fires is a matter of which minutes the
alarm's three datapoints land on. The burst then ran on four tasks, which absorbs more than
three and makes the latency comparison above flattering to this run.

The honest reading is that the pool finding stands on any fleet size, because it is about
connections per task and the per-task peak was 11 of 45 on the warm burst, and that the
latency finding is a four-task number.

## The first burst: one 500 from a cold task

The burst started at 07:19:26, 72 seconds after the fourth task (`8d30c114`) registered
with the load balancer. At 07:19:41 the ALB access log records it answering
`GET /projects?q=database&...&page=1` with a 500 after 5.88 s of target processing, and a
15 KB error page. k6 aborted on it at 07:19:43, as #524's criteria require.

Nothing was queued on any task in that minute (`PoolWaiting` 0), and the busiest pool
held 31 of 45; the metric has no task dimension, so which task that was is not recorded.
Either way it was not waiting for a connection. 5.88 s is just past the 5 s `connectionTimeoutMillis`, which pg-pool applies to
opening a new connection as well as to the queue, and a task a minute old, suddenly taking a
quarter of 42 requests per second on 0.25 vCPU, was opening connections on a starved event
loop. That is the inference; nothing confirms it, because the 500 was never logged. #601
carries it and the options.

The warm re-run six minutes later ran the same burst on the same four tasks with no 5XX,
which is the same pattern the 2026-09-21 run saw at warm-up and the reason to read the
cold attempt as a separate finding and not as the burst failing.

The `Error: aborted` lines in `/ecs/eecs-capstone` at 07:19:43.5, seven requests logged
twice each, are k6 closing its own in-flight requests when it stopped, all on the cold task,
which had the slowest queue. They are not the 500 and not a second failure.

## What this cannot see

The script is anonymous. It does no session lookup, which is what failed on 2026-09-21,
and signed-in requests were not exercised. The inference that they would now succeed rests
on the pool reading: a session lookup fails on the acquire timeout when a request waits more
than 5 s for a connection, and none waited at all. The cold-task 500 in #601 would hit a
signed-in request the same way.

## Still not run

Phases 1d at 50 and 1e at 75 requests per second, and the burst on three warm tasks. The
second is the cheaper and the more useful: it is the configuration a term start actually
meets, since ADR-0040's point is that autoscaling does not fire in time for a burst.
