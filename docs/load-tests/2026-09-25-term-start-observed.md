# Term start, observed: 2026-09-24 to 2026-09-29

Not a load test. This is what production did when the students arrived, read from
CloudWatch (one-minute data, 2026-09-15 to 2026-09-29) and from the ALB access logs for the
two busiest hours. It answers [#524](https://github.com/adulbrich/eecs-capstone/issues/524)
with the real term start rather than a model of one, and closes
[#601](https://github.com/adulbrich/eecs-capstone/issues/601).

**The fleet held with room to spare.** The busiest minute was 2026-09-25 at 10:48 PDT:
2,934 requests, 49 per second, more than the 42 per second burst the k6 runs modelled. Three
tasks served it at 31% average and 41% peak CPU, with no 5XX and nothing queued for a
database connection. Autoscaling never fired from 2026-09-24 on.

**The synthetic workload was about three times heavier than the real one.** k6 requests
nothing but SSR pages. Students mostly make server function calls from pages already loaded:
the peak hour logged 1,108 SSR pages against 38,766 server function calls. That is why 42
synthetic requests per second saturated a task on 2026-09-23 while 49 real ones used a
third of one.

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

Pacific days. 2026-09-20 to 2026-09-23 include the k6 runs, so their peaks and 5XX are
synthetic.

| Day | Requests | Busiest minute | p99 (worst hour) | Task CPU avg / max | Memory max | DB connections max | 5XX |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Thu 09-17 | 37,107 | 322 | 374 ms | 10% / 16% | 45% | 10 | 1 ELB |
| Fri 09-18 | 36,939 | 318 | 1,105 ms | 16% / 24% | 37% | 10 | 3 ELB |
| Tue 09-22 | 41,644 | 250 | 583 ms | 6% / 27% | 15% | 10 | 0 |
| Wed 09-23 | 97,532 | 2,202 (k6) | 1,415 ms (k6) | 71% / 100% (k6) | 22% | 39 | 2 target (k6) |
| Thu 09-24 | 93,694 | 427 | 162 ms | 7% / 30% | 21% | 41 | 0 |
| Fri 09-25 | 308,195 | 2,934 | 223 ms | 31% / 41% | 30% | 41 | 0 |
| Sat 09-26 | 191,259 | 626 | 167 ms | 9% / 20% | 29% | 18 | 0 |
| Sun 09-27 | 333,635 | 981 | 181 ms | 12% / 27% | 30% | 18 | 0 |
| Mon 09-28 | 128,796 | 402 | 416 ms | 11% / 26% | 23% | 40 | 4 target |

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
task at full CPU opening connections, and real traffic did not come near full CPU.

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
are most of the traffic: #725 halves the bell and #726 halves the detail loader.

Across the two hours, bytes split 85% server function JSON and 14% SSR HTML. Neither is compressed, and
CloudFront cannot compress either because both stream without a `Content-Length`, which is
why #194 moved to origin compression.

## Not run

Phases 1d (50 per second) and 1e (75 per second), and the #601 load test after a lull. The
term start exceeded phase 2's rate on real traffic without stress, and the scenario #601
guards against needs CPU the real mix does not use. Run them next term if the traffic mix
changes, and model the mix above rather than SSR pages alone.
