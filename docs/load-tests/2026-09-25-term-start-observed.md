# Term start as production saw it, 2026-09-22 to 2026-09-29

Not a load test, so not titled like one. This is what production did when the students
arrived, read from CloudWatch (one-minute data) and from the ALB access logs for the two
busiest hours. The file is dated 2026-09-25, the peak. It answers
[#524](https://github.com/adulbrich/eecs-capstone/issues/524) with the real term start
rather than a model of one, and closes
[#601](https://github.com/adulbrich/eecs-capstone/issues/601).

**Nothing broke, up to 49 requests per second.** The busiest minute was 2026-09-25 at
10:48 PDT: 2,934 requests, more than the 42 per second burst the k6 runs modelled. Three
tasks served it at 31% average and 41% peak CPU, with no 5XX and nothing queued for a
database connection. Autoscaling never fired from 2026-09-24 on.

**Real traffic is lighter per request than the k6 mix, and spreads more evenly.** k6
requests nothing but SSR pages. Students mostly make server function calls from pages
already loaded: the peak hour logged 1,108 SSR pages against 38,766 server function calls.
The k6 burst on 2026-09-23 at 42 per second held the three tasks at 38.9% average CPU but
drove one to 99.6%, and that task is where #601's 500 came from. The real burst at 49 per
second averaged 31%, about two thirds of k6's CPU per request, and its busiest task never
passed 41%.

## Configuration

| | 2026-09-24 on |
| --- | --- |
| Tasks | 3, autoscaling 3 to 4 on 50% average CPU (ADR-0040) |
| Task size | 256 CPU units (0.25 vCPU), 1024 MB, Fargate ARM64 |
| Pool | 45 per task, warm floor of 5 ([ADR-0052](../adr/0052-the-pool-keeps-a-warm-floor.md)) |
| Database | `db.t4g.small` |

2026-09-22 and 2026-09-23 ran the same task size on two to four tasks while the floor and
the pool settings were being changed.

## The peak against #524's phase 2 criteria

| Criterion | 2026-09-25 peak | |
| --- | --- | --- |
| p95 under 500 ms | 32 ms (hourly, `TargetResponseTime`) | pass |
| p99 under 1500 ms | 223 ms (hourly) | pass |
| Zero 5XX | 0 | pass |
| `DatabaseConnections` below the pool maximum | 41 of 135 (three tasks at 45) | pass |
| ECS `MemoryUtilization` under 75% | 30% | pass |
| `runningCount` never drops | 3 throughout | pass |

CloudWatch keeps latency percentiles at one-hour resolution here, so the latency rows are
the busiest hour, not the busiest minute. The ALB logs for that hour agree: target
processing p50 6 ms, p99 221 ms. These are origin latencies; a browser adds CloudFront and
the network.

## Day by day

Pacific days. Latencies are the worst hour of the day. 2026-09-23 includes the k6 runs
(00:12 to 00:59 PDT), marked. 2026-09-29 runs to 09:00 PDT.

| Day | Tasks | Requests | Busiest minute | p50 / p95 / p99 | CPU avg / busiest task | Memory max | DB connections max | 5XX (rate) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tue 09-22 | 2 to 3 | 41,644 | 250 | 37 / 135 / 583 ms | 6% / 27% | 15% | 10 | 0 |
| Wed 09-23 | 2 to 4 | 97,532 | 2,202 (k6) | 42 / 522 / 1,415 ms (k6) | 71% / 100% (k6) | 22% | 39 | 2 target, k6 |
| Thu 09-24 | 3 | 93,694 | 427 | 7 / 23 / 162 ms | 7% / 30% | 21% | 41 | 0 |
| Fri 09-25 | 3 | 308,195 | 2,934 | 6 / 32 / 223 ms | 31% / 41% | 30% | 41 | 0 |
| Sat 09-26 | 3 | 191,259 | 626 | 6 / 21 / 167 ms | 9% / 20% | 29% | 18 | 0 |
| Sun 09-27 | 3 | 333,635 | 981 | 6 / 20 / 181 ms | 12% / 27% | 30% | 18 | 0 |
| Mon 09-28 | 2 to 3 | 128,796 | 402 | 7 / 28 / 416 ms | 11% / 26% | 23% | 40 | 4 target (0.003%) |
| Tue 09-29 | 2 to 3 | 12,961 | 71 | 7 / 11 / 60 ms | 4% / 24% | 13% | 17 | 0 |

Two tasks on 09-28 and 09-29 are deploys, which replace one task at a time (ADR-0043).

The four target 5XX on 2026-09-28 were malformed search params on the project listing,
logged by #602 and fixed by #699 (deployed 2026-09-29). There has been no ELB 5XX since the
keep-alive fix (#549) on 2026-09-21. RDS CPU stayed at or below 7.1% throughout, and
`CPUCreditBalance` stayed at its ceiling of 576.

## The pool floor (#601)

ADR-0052's floor deployed on 2026-09-23 at 19:22 UTC. Since then:

- No `Database pool warm-up opened N of 5` line in `/ecs/eecs-capstone`.
- `PoolTotal` minimum 5 in every minute from 2026-09-24 on.
- `DatabaseConnections` minimum 15 with three tasks, 10 during deploys.

The 2026-09-25 burst climbed from 1,236 requests a minute at 10:44 to 2,934 at 10:48.
`PoolTotal` went from 5 to 8 and `PoolWaiting` stayed 0. The failure #601 describes needs a
task at full CPU opening connections, and no real task came near full CPU.

## Where the requests went

The busiest hour of each peak, by share of origin requests:

| Server function | 2026-09-25 10:00 PDT | 2026-09-27 21:00 PDT |
| --- | --- | --- |
| `getProject` + `listProjectCategories` (project detail loader) | 42% | 21% |
| `unreadCount` + `listMyNotifications` (notification bell) | 24% | 59% |
| `searchProjects` + `listProjectFilterOptions` (listing) | 11% | 5% |
| `/api/traffic` (page views) | 6% | 3% |
| SSR pages | 2.5% | 0.8% |

The detail loader runs on every hover of a project card (`defaultPreload: "intent"` with
`defaultPreloadStaleTime: 0`), which is why it outnumbers SSR detail pages 30 to 1. The bell
polls once a minute in every signed-in tab. Neither is a capacity problem, but together they
are most of the traffic: #725 will halve the bell's requests and #726 the detail loader's.

Across the two hours, bytes split 85% server function JSON and 14% SSR HTML. Neither is
compressed, and CloudFront cannot compress either because both stream without a
`Content-Length`, which is why #194 moved to origin compression.

## Not run

Phases 1d (50 per second) and 1e (75 per second), the 8 per second tail, and both #601
scenarios: the three-task burst after ten idle minutes (the real burst ramped from 1,236 a
minute, not from a lull), and a burst landing on a freshly scaled-out task (autoscaling
never fired, so no real traffic tested one). Both #601 failures needed a task at full CPU,
which the real mix did not produce. Run them next term if the traffic mix changes, and
model the mix above rather than SSR pages alone.
