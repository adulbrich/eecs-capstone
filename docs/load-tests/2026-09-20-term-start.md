# Load test: 500 student term start, 2026-09-20

Issue [#524](https://github.com/adulbrich/eecs-capstone/issues/524). Script:
[`scripts/loadtest/projects-browse.js`](../../scripts/loadtest/projects-browse.js).

Run from a laptop in Corvallis against production, Sunday 2026-09-20 from 19:58 to 20:08 PDT,
with background traffic at about 0.5 requests per second. Client latency therefore carries
roughly 20 ms of Corvallis to `us-west-2` round trip that a request from campus would also pay.

**This run is partial.** Phases 0, 1a and 1b are below. Phases 1c through 2 are not, and the
reason is in "Why the ramp stopped" at the end. Nothing failed. When the remaining phases run,
add their rows to the table in this file and date them in the row, rather than starting a
second file: it is one run of one issue, interrupted.

## Configuration under test

Not the configuration #524 was written against. #522 and #529 landed first, so the numbers in
the issue's "what is already known" table describe a fleet that no longer exists.

| | At the time of this run |
| --- | --- |
| Tasks | 2, autoscaling 2 to 4 on 50% average CPU, 60 s out, 600 s in |
| Task size | 256 CPU units (0.25 vCPU), 1024 MB, Fargate ARM64 |
| Database | `db.t4g.small`, resized from `db.t4g.micro` 35 minutes before the run |
| Pool | 20 connections per task, 5 s acquire timeout (ADR-0034) |

## Results

Latency is client side from k6, across all four steps of the session. The CloudWatch columns are
the highest one minute datapoint inside each phase, on non-overlapping windows. CPU and memory
are each given twice on purpose: the average is the fleet number, and
`ECSServiceAverageCPUUtilization` is what the autoscaling policy tracks, while the peak is the
hottest single task and runs several points higher. Comparing a peak against the 50% target
would be comparing the wrong statistic. No phase dropped an iteration, so each ran at the rate
it claims.

| Phase | Rate | p50 | p95 | p99 | slowest | Errors | CPU avg | CPU peak | Mem avg | Mem peak | DB conns | Tasks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0. Baseline | 1/s | 70 ms | 179 ms | 266 ms | 370 ms | 0% | 6.5% | 8.8% | 9.8% | 11.1% | 6 | 2 |
| 1a | 5/s | 62 ms | 154 ms | 243 ms | 605 ms | 0% | 21.9% | 24.9% | 15.2% | 16.1% | 6 | 2 |
| 1b | 10/s | 61 ms | 173 ms | 389 ms | 771 ms | 0% | 39.8% | 47.6% | 17.8% | 18.0% | 10 | 2 |
| 1c | 25/s | not run | | | | | | | | | | |
| 1d | 50/s | not run | | | | | | | | | | |
| 1e | 75/s | not run | | | | | | | | | | |
| 2. Term start | 42/s then 8/s | not run | | | | | | | | | | |

Zero 5XX at the target and zero at the load balancer across all three phases. `runningCount`
never moved off 2, and no scaling activity fired: the fleet average peaked at 39.8%, under the
50% target.

## What broke first

Nothing, at the rates reached. The useful measurement is the slope.

CPU is the binding resource. Against the fleet total of 0.5 vCPU, the three phases fit a
straight line at about **19 ms of vCPU per request**, with an idle floor small enough to be
noise: the three pairwise fits give 19.6, 18.7 and 19.1 ms and an intercept under 2% of the
fleet. That is roughly four times the 5 ms per request the issue extrapolated from a month of
CloudWatch. The likely reason is workload mix rather than arithmetic: a month of production is
mostly cheap requests, health checks and redirects and small routes, while every request in this
test is a projects listing render, three queries and 90 to 145 KB of HTML. The expensive path is
also the one 500 students will be on, so 19 ms is the number to plan with.

What that implies, and it is an extrapolation rather than a measurement:

- The 50% autoscale target trips at about 13 requests per second on 2 tasks. Phase 1b landed
  just short of it, which is why nothing scaled.
- 4 tasks is about 52 requests per second at 100% CPU, and about 26 at the 50% target.
- The phase 2 burst of 42 requests per second needs about 0.80 vCPU. Two tasks have 0.5, so
  2 tasks cannot serve that burst at all, they saturate. Reaching 4 tasks in time is unlikely:
  CloudWatch's one minute resolution, the 60 s scale out cooldown and Fargate task start
  together run past the two minutes the burst lasts. The prediction is that phase 2 saturates
  on 2 tasks and that the p99 threshold is what aborts it, and that phase 2 rather than 1d is
  the phase that hurts.

Confirming or killing that prediction is what phases 1c through 2 are for. Do not act on it
before they run.

Memory never became interesting: 18.0% of 1024 MB at the worst, against #524's 75% criterion.
The database is nowhere near a constraint. It held 7.5% CPU and 10 connections at 10 requests
per second, against a pool ceiling of 20 per task and 220 usable on the instance.

## Why the ramp stopped at 1b

#529 resized the database from `db.t4g.micro` to `db.t4g.small` at 19:23 PDT, 35 minutes before
this run. A class change restarts the instance, and the restart throws away the accrued burst
credit balance. The five minute series says it plainly: `CPUCreditBalance` had been flat at its
288 cap all day, read 288.0 at 19:20, and read 0.0 at 19:25. `CPUSurplusCreditBalance` began
accruing at the same time, which is the instance spending past a balance it does not have.

#524's own abort criteria say to stop when the credit balance falls. It had already fallen to
zero before the first request. From there it refills at a flat 1.5 credits per five minute
datapoint, every datapoint: 0.57 at 19:30, 2.07, 3.63, 5.16, 6.72, 8.20, 9.74, 11.19, 12.65,
14.22 at 20:15. The first interval is short because the restart lands inside it; every interval
after it is between 1.45 and 1.57. That is **18 credits per hour**, and the loaded phases did
not bend it: the last three intervals span phases 1a and 1b and accrue at the same rate as the
idle ones.

18 rather than the nominal 24 is arithmetic, not a mystery. A burstable instance earns at a
fixed rate and spends a credit per vCPU minute used, so net accrual is
`24 - (CPU fraction x 2 vCPU x 60)` per hour. The 20% baseline is exactly where those cancel.
This instance sat near 5%, which spends 6 and nets 18. The same formula prices the heavy
phases: nothing is spent on net until average CPU crosses 20%, and 1d and 1e are the only
phases predicted to cross it.

The heavy phases would not stay under it. Spending past zero costs a surplus charge rather than
an immediate throttle, and the throttle to baseline arrives only if surplus outruns what 24
hours of accrual repays, but the result either way is a live database degraded past the end of
the test. The phases themselves are cheap: at the measured database load they spend a handful
of credits in total, because only 1d and 1e cross the 20% baseline at all and only for minutes.
The point is having a balance to spend them from.

**Wait for `CPUCreditBalance` at 100 or more, and read it rather than trusting the clock.** At
18 per hour from 14.2 at 20:15 PDT, it crosses 100 around 01:00 PDT and reads about 170 by
05:00. Monday 05:00 to 07:00 PDT is the window to use: quiet, and before term traffic.

## Running the rest

```bash
BASE=https://capstone.eecs.oregonstate.edu
IDS=/path/to/ids.txt RPS=25 DURATION=3m k6 run scripts/loadtest/projects-browse.js
```

Order matters for phase 2. Run 1c, 1d and 1e back to back, then **wait for `runningCount` to
read 2 again before starting phase 2**, which takes at least the 600 s scale in cooldown and in
practice longer. Phase 2 asks whether autoscaling catches a cold two minute burst; run on the
warm 3 or 4 task fleet that 1e leaves behind, it answers a different and easier question. Phase
2 is also two invocations rather than one, `RPS=42 DURATION=2m` and then `RPS=8 DURATION=10m`.

Run it attended. #524 wants the owner told, the abort criteria in front of you and a hand on
the stop, and the credit threshold is something to read rather than a time to wait until.

`ids.txt` is one project id per line and is deliberately not committed. Rebuild it by pulling
ids out of the listing and keeping the ones that answer 200, because the listing payload also
carries category and program ids and a 404 on a bad one counts against the 1% failure
threshold:

```bash
F='categories=%5B%5D&program=null&archivedOnly=false&acceptingOnly=true&studentProposedOnly=false&requiresNdaOnly=false'
for p in 1 2 3; do
  curl -s "$BASE/projects?q=&$F&page=$p" | tr -d '\000' \
    | grep -aoE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
done | sort -u | while read -r id; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/projects/$id")" = 200 ] && echo "$id"
done > ids.txt
```

60 of the 91 candidate ids on the first three pages were projects. The rest were categories and
programs, which would have answered 404.

## Notes for whoever runs this next

- **`RPS` is requests per second, not sessions per second.** #524's script set
  `rate: RATE, timeUnit: "1s"` on an executor that counts iterations, and one iteration is a
  four request session, so its rates were four times what the phase table intended. The
  committed script uses `timeUnit: "4s"` and the phase table above means what it says.
- **Use the canonical query string.** `/projects` and `/projects?q=x` answer 307 with the fully
  spelled out filter set. k6 follows redirects, so the issue's URLs would have cost seven origin
  requests per session and split every step's latency across two samples.
- **Watch `x-cache`.** The script checks every response for `Miss from cloudfront`. A Hit would
  mean the CDN answered and the task never saw the request, which would make the run measure
  CloudFront rather than the app. Every response in this run was a Miss.
- **Read ECS CPU as `Average`, not `Maximum`.** The autoscaling policy tracks the fleet average.
  A `Maximum` reading is the hottest task and runs several points higher, which is the wrong
  number to compare against the 50% target.
- **Nothing recorded this run inside the app.** The site traffic writer of ADR-0034 and #18 is
  not built yet, so these 2824 requests are not in any application table. They are in the ALB
  access logs turned on by #523, where the script identifies itself as
  `User-Agent: k6-loadtest-524`.
