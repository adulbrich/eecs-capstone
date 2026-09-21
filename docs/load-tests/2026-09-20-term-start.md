# Load test: 500 student term start, 2026-09-20 and 2026-09-21

Issue [#524](https://github.com/adulbrich/eecs-capstone/issues/524). Script:
[`scripts/loadtest/projects-browse.js`](../../scripts/loadtest/projects-browse.js).

Run from a laptop in Corvallis against production, Sunday 2026-09-20 from 19:58 to 20:08 PDT,
with background traffic at about 0.5 requests per second. Client latency therefore carries
roughly 20 ms of Corvallis to `us-west-2` round trip that a request from campus would also pay.

Run in two sittings. Sunday evening covered phases 0, 1a and 1b at 1, 5 and 10 requests per
second, and stopped early for a reason worth keeping: "Why the Sunday ramp stopped at 1b",
below. Monday 06:33 to 06:42 PDT covered phase 2 and phase 1c, from the same laptop, against
background traffic of 0.07 requests per second.

**The Monday sitting was stopped by hand on #524's abort criterion: 5XX appeared.** Seven of
them, all inside the test window, against zero in the previous 24 hours. Stopped by hand is the
accurate phrasing and the distinction matters: both Monday phases ran to completion, and the
decision to stop came after reading CloudWatch afterwards, not from k6 cutting a run short. Why
that is, and why it is a flaw in the method rather than a judgement call, is under "What the
thresholds actually do" below. Phases 1d and 1e were never run and should not be until the 502
is understood. Everything the issue set out to learn was answered anyway, and the answers are
not the ones the extrapolation predicted.

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
| 1c (Mon) | 25/s | 104 ms | 633 ms | 1.40 s | 3.87 s | 0.11% | 85.9% | 90.3% | 23.0% | 23.2% | 21 | 2 |
| 2. Burst (Mon) | 42/s | 892 ms | 2.97 s | 4.25 s | 4.37 s | 0% | 12.9% | 55.6% | 14.9% | 17.4% | 40 | 2 |
| 2. Burst, held (Mon) | 42/s | 4.12 s | 6.19 s | 6.68 s | 8.11 s | 0.07% | 99.7% | 99.9% | 22.2% | 22.5% | 40 | 2 |
| 1d | 50/s | not run, stopped on 5XX | | | | | | | | | | |
| 1e | 75/s | not run, stopped on 5XX | | | | | | | | | | |
| 2. Tail | 8/s | not run, stopped on 5XX | | | | | | | | | | |

The two burst rows are the same phase twice. The first ran under #524's `p99 < 3s` abort and
stopped after 8 seconds, which reports that the phase degraded and nothing about how. The second
raised the latency abort to 10 s for 90 seconds, leaving the zero-error abort untouched, to see
the shape. Read the first row as the moment of failure and the second as the steady state
behind it.

Neither burst row reached 42 requests per second. The first was still ramping in. The second
absorbed **26.3**, dropping 267 iterations because the site could not take them: at saturation
k6 cannot offer the target rate through a bounded VU pool, and the gap between offered and
absorbed is itself the measurement.

Sunday's three phases produced zero 5XX anywhere and never moved `runningCount` off 2, with the
fleet average peaking at 39.8%. Monday's did move the needle, and the next three sections are
what it moved.

## What broke first, and at what rate

Three things, in this order. The headline: **two tasks serve about 26 requests per second, the
term start burst needs 42, and autoscaling does not arrive.**

### 1. Autoscaling never fired, and that is the finding to act on

`runningCount` held at 2 through every Monday phase. The last scaling activity on this service
is from Sunday 19:24, before any of this ran. The fleet average CPU during phase 1c was 72.8%,
85.9% and 82.0% on three consecutive one minute datapoints, against a policy whose `AlarmHigh`
threshold is 50% over three periods of 60 seconds. It stayed `OK`.

Whatever the mechanism, and the alarm's evaluation timing against the ECS publication lag is
the place to look, the operational fact is measured rather than predicted: **three consecutive
minutes at 72 to 86 percent CPU did not add a task.** The Sunday prediction was that
autoscaling could not react inside a two minute burst. It is worse than that. It also did not
react to three minutes of sustained overload.

Term start is a burst. Autoscaling that needs three minutes to notice, a minute of cooldown and
a Fargate task start cannot be the plan for it. The fleet has to be big enough before the
students arrive, which means `app_min_tasks`, not `app_max_tasks`. That is
[#546](https://github.com/adulbrich/eecs-capstone/issues/546), which also carries why the alarm
did not fire as a thing to diagnose rather than a thing assumed.

### 2. Under saturation the app breaks connections mid-response, as 502

Seven `HTTPCode_ELB_5XX_Count` inside the test window, zero `HTTPCode_Target_5XX_Count`, and
zero in the previous 24 hours. The app never returned a 500. The ALB access logs #523 turned on
say what happened instead, and all four in the retrieved window agree:

```
elb_status_code 502, target_status_code -, target_processing_time 0.14 to 0.25, response_processing_time -1
```

**Corrected after #545 was diagnosed.** This paragraph first read those fields as the task
beginning to respond in about 200 ms and then breaking mid-response. They say the opposite.
AWS records `target_status_code` "only if a connection was established to the target and the
target sent a response", and sets `response_processing_time` to -1 when "the target closes the
connection before the idle timeout". No response was ever sent. The task had closed the pooled
connection the load balancer then dispatched onto: Node closes an idle keep-alive connection
after 5 seconds by default and the ALB reuses one for 60. Saturation is why it showed up here
and not in Sunday's phases, because 42 requests per second on two tasks opens far more
connections than 10 does, but saturation was never the cause. Both tasks did it, on ordinary
listing and detail GETs. Seven failures across roughly 7200 requests is 0.1%, and every one of
them is a student seeing an error page.

This is the one result here that is a defect rather than a capacity number. It is
[#545](https://github.com/adulbrich/eecs-capstone/issues/545). ADR-0039 carries the fix, which is not the same as the issue being closed: that waits on a phase 1c re-run after the deploy showing no ELB 5XX. And
`scripts/loadtest/pooled-connection-reuse.mjs` reproduces it against a local build in about
thirty seconds without any load at all. 1d and 1e should still wait for a deploy that carries
the fix, because they exist to push further into exactly the regime that produced it.

### What the thresholds actually do

#524 says to stop the moment a 5XX appears. Nothing in this setup does that, and it is worth
being exact about why, because the script reads as though it does.

The error threshold is `http_req_failed: rate<0.01`, which is **a failure rate across the whole
run, not a trip on the first bad response**. The held burst finished at 0.07% and 1c at 0.11%.
Neither came near 1%, so neither aborted, and both ran to completion with 5XX already in them.
An earlier draft of this document and a comment in the script both claimed a 5XX aborts at any
setting. That was wrong, and it is corrected in both places.

CloudWatch is no help in real time either. The held burst ended at 06:38:00, ALB 5XX was
queried immediately and returned no datapoints, 1c started at 06:38:56, and the 06:37 datapoint
only became visible afterwards. Metrics publish a minute or two late and the access logs are
written every five minutes, so "check for 5XX between phases" cannot give a clean answer
between back-to-back phases.

So the run stopped when a human read the numbers, one phase later than #524 intends.

**The script now does what the issue asked.** It counts responses with a status of 500 or above
into a `server_errors` metric and holds that metric to `count<1` with `abortOnFail`. A rate
cannot express "the first one stops it" and a counter can, and k6 re-evaluates thresholds every
few seconds, so a run now stops seconds after the first 5XX instead of never. Verified against
production at 2 requests per second: the threshold registers and reports `count=0`.

That is the fix, not a workaround. The two fallbacks are still worth knowing, because
CloudWatch is the only place an `ELB_5XX` with no client-visible failure would show up:

- Treat any non-zero `http_req_failed` in a k6 summary as a stop signal. k6 reports it the
  moment the run ends. Both Monday phases carried it, and that was the fast signal available.
- Leave three minutes between phases if CloudWatch is the source of truth, because metrics and
  access logs both publish too late to clear a phase that just ended.

Not to be confused with the 57 `460`s in the same logs. Those are the ALB recording that the
client went away, and the client was k6 interrupting its own in-flight iterations when the
first burst aborted. They are all timestamped in that one minute and they are not server
failures. The task logs agree and were read while diagnosing #545: `/ecs/eecs-capstone` holds
46 `Error: aborted` objects with `ECONNRESET` at `abortIncoming`, all inside the half second
at 13:33:17 UTC, and nothing at all in 13:35 to 13:42 UTC, which is the window holding all
four retrieved 502s. The task logs a client that goes away and logged nothing for the 502s.

### 3. The knee is between 25 and 42 requests per second

25 requests per second is serviceable: p50 104 ms, p95 633 ms, p99 1.40 s, sustained for three
minutes with 2 dropped iterations out of 1124. It is not comfortable, since #524's phase 2
criteria are p95 under 500 ms and p99 under 1500 ms and this only just clears the second while
missing the first, but it works.

42 requests per second is not serviceable on two tasks. The site absorbed 26.3, latency settled
around a p50 of 4.12 s, and one task sat at 99.6% CPU.

### What that does to the Sunday extrapolation

Sunday's three phases fit a straight line at about 19 ms of vCPU per request and predicted
about 26 requests per second for two tasks at 100% CPU. Monday measured 26.3. **The model was
right**, which is worth saying because the rest of this section is about things the model did
not predict: the scaling policy not engaging, and the 502.

The per request cost stands at about 19 ms, roughly four times the 5 ms #524 extrapolated from
a month of CloudWatch. The likely reason is workload mix rather than arithmetic: a month of
production is mostly cheap requests, health checks and redirects and small routes, while every
request in this test is a projects listing render, three queries and 90 to 145 KB of HTML. The
expensive path is also the one 500 students will be on.

### Sizing, from the measurement rather than the model

- Two tasks are about 26 requests per second. Four are about 52.
- The term start burst of 42 requests per second needs at least three tasks, and four to have
  any margin.
- Autoscaling will not deliver them in time, so they have to be running beforehand.

### The database was never the constraint

RDS CPU never exceeded 9%, and the credit balance **rose** from 212 to 215 across the whole
Monday sitting. `DatabaseConnections` is more interesting: it pinned at exactly 40, which is
two tasks times the pool maximum of 20, through both burst minutes, while sitting at 20 to 21
under sustained 25 requests per second. ADR-0034 names that number as the signal to watch: "If
it pins to 20, headroom is gone again." Under a burst it pins. Whether the pool is a binding
constraint or merely a mirror of requests queued behind a saturated CPU is not separable from
these runs, because CPU was at its own ceiling at the same time. Raising tasks raises the pool
total with it, so the sizing above addresses both; ADR-0034's budget has room for eight tasks.

### Memory was never close

23.2% of 1024 MB at the worst, against #524's 75% criterion. It rose with load and never
threatened anything.

## Why the Sunday ramp stopped at 1b

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

**Wait for `CPUCreditBalance` at 100 or more, and read it rather than trusting the clock.** That
is what Monday did: the balance read 212 at 06:31 PDT with the surplus repaid to zero, and it
rose to 215 across the sitting rather than falling. The database was never close to being the
problem, which the Sunday abort could not have known.

## Running the rest

```bash
BASE=https://capstone.eecs.oregonstate.edu
IDS=/path/to/ids.txt RPS=25 DURATION=3m k6 run scripts/loadtest/projects-browse.js
```

`P99_ABORT_MS` raises the latency abort from #524's 3000 for a deliberately short run when the
failure shape is the point. It cannot loosen the error thresholds, which have no override and
now stop the run on the first 5XX. "What the thresholds actually do" explains why that took a
counter rather than a rate.

**Do not run 1d or 1e until the 502 fix is deployed.** It has an explanation now (#545,
ADR-0039), but until the deploy carrying it is live these phases push further into the regime
that produces it, on a live site, and a louder version of a known failure is not worth a
student seeing an error page for. The first thing to check after that deploy is
`HTTPCode_ELB_5XX_Count` across a re-run of 1c, which is what actually closes #545.

Phase 2 should run on a cold 2 task fleet, because term start is itself a cold fleet event.
Monday got that for free by running phase 2 first; after a ladder it means waiting for
`runningCount` to fall back, which takes at least the 600 s scale in cooldown. The 8 requests
per second tail was never run and is the least interesting phase left: 1a at 5 and 1b at 10
bracket it and both were uneventful.

Run it attended. #524 wants the owner told, the abort criteria in front of you and a hand on
the stop.

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
