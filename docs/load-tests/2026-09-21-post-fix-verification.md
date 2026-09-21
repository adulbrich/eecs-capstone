# Load test: verifying the #545 fix and the #546 floor, 2026-09-21

Run from a laptop in Corvallis against production, 2026-09-21 from 21:46 to 21:53 UTC
(14:46 to 14:53 PDT), immediately after the deploy of
[#549](https://github.com/adulbrich/eecs-capstone/pull/549) and
[#550](https://github.com/adulbrich/eecs-capstone/pull/550). Script:
[`scripts/loadtest/projects-browse.js`](../../scripts/loadtest/projects-browse.js).
Method, warnings and the two-task baseline are in
[`2026-09-20-term-start.md`](./2026-09-20-term-start.md); this run exists to answer
the one question that document left open, which is whether the 502 is gone.

**It is.** Zero `HTTPCode_ELB_5XX_Count` and zero `HTTPCode_Target_5XX_Count` across
the whole session, including a 42 requests per second burst that took the hottest
task to 98% CPU. The comparable run on 2026-09-21 morning produced seven.

## Configuration under test

| | At the time of this run |
| --- | --- |
| Tasks | 3, autoscaling 3 to 4 on 50% average CPU (ADR-0040) |
| Task size | 256 CPU units (0.25 vCPU), 1024 MB, Fargate ARM64 |
| Database | `db.t4g.small`, `CPUCreditBalance` 371 and rising, surplus 0 |
| Pool | 20 connections per task, 5 s acquire timeout (ADR-0034) |
| Keep-alive | 65 s, above the ALB's 60 s `idle_timeout` (ADR-0039) |
| Baseline | zero ELB 5XX and zero target 5XX in the preceding 3 hours |

Tasks had been running 7 minutes when the first phase started, which matters below.

## Results

| Phase | Rate | p50 | p95 | p99 | max | Absorbed | Dropped | ELB 5XX | CPU avg | CPU peak |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1c | 25/s, 3m | 41 ms | 287 ms | 661 ms | 2.14 s | 24.3/s | 0 | **0** | 61.3% | 70.4% |
| 2. Burst | 42/s, 90s | 151 ms | 1.01 s | 1.99 s | 4.27 s | 39.6/s | 2 | **0** | 91.5% | 98.3% |

All 16552 checks passed, every response an origin miss, `server_errors` 0 in both
phases. 8276 requests through the origin against the morning's roughly 7200.

Against the two-task baseline, on the same script and the same rates:

| | Two tasks (06:39 PDT) | Three tasks (21:47 UTC) |
| --- | --- | --- |
| 1c p50 / p95 / p99 | 104 ms / 633 ms / 1.40 s | 41 ms / 287 ms / 661 ms |
| 1c errors | 0.11% | 0 |
| Burst absorbed | 26.3/s, 267 iterations dropped | 39.6/s, 2 dropped |
| Burst p50 | 4.12 s | 151 ms |
| ELB 5XX over the sitting | 7 | 0 |

ADR-0040 predicted three tasks at "about 39" requests per second from the measured
26.3 on two. The burst absorbed 39.6. The arithmetic held, which is worth saying
because it is the only part of that ADR that was a projection.

The burst is closer to serviceable than ADR-0040 expected. It predicted a fleet at
its absorption limit would be serving slowly, on the morning's evidence that 26.3
came with a p50 of 4.12 s. At 39.6 the p50 was 151 ms and the p95 1.01 s. So three
tasks do not merely absorb 42 requests per second, they absorb it while staying
inside #524's p99 criterion of 1500 ms, though not its p95 criterion of 500 ms.

## The first attempt aborted, and it was warm-up

Phase 1c was started once at 21:47:02 with #524's default `p99 < 3s` abort and
stopped after 8 seconds on p99 3.33 s, with `server_errors` 0. Re-run 18 seconds
later with `P99_ABORT_MS=10000`, the same phase settled at a p99 of 661 ms over
three minutes. The difference is the tasks, which the deploy had started 7 minutes
earlier: a cold Node process pays JIT compilation, first render of each route and a
cold connection pool.

This is worth writing down because it will happen again on every post-deploy run,
and because an 8 second abort reports that a phase degraded and nothing about how.
**After a deploy, give the fleet a few minutes or expect the first minute to abort
on latency.** The 13 `HTTPCode_ELB_4XX_Count` at 21:47 are the ALB recording k6
interrupting its own 42 in-flight iterations on that abort, the same 460s the
morning run logged; `HTTPCode_Target_4XX_Count` was 0.

## The 502 is gone, and the task logs agree

Zero ELB 5XX, zero target 5XX, per minute across 21:46 to 21:56. The diagnosis in
[ADR-0039](../adr/0039-the-task-outlasts-the-load-balancer-idle-timeout.md)
predicted this and the logs corroborate it the same way they did before: the only
`Error: aborted` / `ECONNRESET` clusters in `/ecs/eecs-capstone` are at 21:47:11,
the second the aborted run cut its own iterations, and at 21:53:38. Both are
clients going away. Nothing at all during either completed phase.

## What broke instead: the pool, on signed-in requests

The burst did not produce a 5XX, but it did produce this, at 21:53:05, seconds
after phase 2 ended:

```
ERROR [Better Auth]: INTERNAL_SERVER_ERROR DrizzleQueryError: Failed query:
  select "id", "expires_at", "token", ... from session
cause: Error: Connection terminated due to connection timeout
  [cause]: Error: Connection terminated unexpectedly
```

That is ADR-0034's 5 second acquire timeout firing on a session lookup.
`DatabaseConnections` read 54 at 21:51 and **59 at 21:52** against a fleet maximum
of 60, which is three tasks at the pool maximum of 20. It pinned, exactly as it
pinned at 40 of 40 on two tasks, and ADR-0034 names that number as the signal to
watch: "If it pins to 20, headroom is gone again."

Three things follow.

- **The load test cannot see this.** The script is anonymous, so it never does a
  session lookup. These failures hit signed-in users, and they were real people
  rather than the test. A run that reports zero errors is not reporting that
  signed-in requests were fine.
- **It is invisible to the abort criteria too.** No 5XX reached the balancer, so
  neither `server_errors` nor `HTTPCode_ELB_5XX_Count` moved. The criterion that
  closes #545 would have passed through this unchanged.
- **The pool is the next constraint, not CPU.** CPU peaked at 98% and served
  everything. The pool hit its ceiling and dropped work.

Raising `app_min_tasks` again makes this worse rather than better, because the pool
maximum is per task and the fleet total rises with the task count while the
instance's 220 stays put. ADR-0034's budget has room, so the fix is a number rather
than an instance, but it is a decision and wants its own issue.

## The database was still not the constraint

RDS CPU peaked at 13.3%, and `CPUCreditBalance` rose from 371.5 to 372.8 across the
sitting. Memory peaked at 23.8% of 1024 MB, which is where it sat on two tasks, so
CPU still leads memory by a wide margin and ADR-0040's reading of the scaling signal
stands.

## Autoscaling did not fire, correctly

`runningCount` held at 3. The burst put the fleet average over 50% for two minutes,
21:51 at 48.7% and 21:52 at 91.5%, and `AlarmHigh` needs three consecutive. This is
the same structural lag [ADR-0040](../adr/0040-the-fleet-is-sized-before-the-burst-not-during-it.md)
describes and is the reason the floor was raised rather than the policy retuned. A
90 second burst is shorter than the alarm can see, which is the point.

## Still not run

Phases 1d at 50 and 1e at 75 requests per second, and the 8 requests per second
tail. 1d and 1e were held back pending the 502 fix, which has now shipped, so the
reason not to run them is gone. What is worth deciding first is whether to run them
at all before the pool ceiling above has an answer, because they push further into
the regime that produced it and the people who feel it are signed in.
