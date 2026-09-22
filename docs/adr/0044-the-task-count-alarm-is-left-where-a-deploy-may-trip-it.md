# The task-count alarm is left where a deploy may trip it

`infra/alarms.tf` alarms when `ECS/ContainerInsights` `RunningTaskCount` is
below `var.app_min_tasks` for three consecutive one-minute periods, which is the
threshold #571 specified, and it is left there although an ordinary deploy is
capable of meeting it.
[ADR-0043](./0043-a-deploy-dips-rather-than-doubles.md) caps a deploy at the
desired count, so ECS stops a task before starting its replacement and the fleet
reads two of three while that happens, three times in sequence. How many
consecutive one-minute samples that costs is not known, and the honest answer is
that nobody has watched this metric through a deploy. ADR-0043's "about three
minutes per task" is wall clock for a drain, a start and two health checks;
`RunningTaskCount` counts tasks in RUNNING, which a replacement enters before it
is healthy and which a draining task leaves as soon as it is stopping, so the
dip this alarm can see is shorter than that number and may be one or two samples
rather than three. The plausible outcomes are a deploy that trips nothing, a
deploy that trips once, and a deploy that oscillates three and two across the
sampling boundary and sends several ALARM and OK pairs. The alternatives were
weighed against the worst of those and each buys quiet by giving up coverage
that matters more. Raising `datapoints_to_alarm` past the dip means the alarm no
longer catches a fleet that has been down for the same number of minutes, which
is the case it exists for. Alarming on zero tasks instead catches a total outage
and misses two of three tasks crash-looping, which is the shape a bad image
actually fails in. Suppressing the alarm for the duration of a deploy needs a
second mechanism, in the deploy workflow, that nobody would maintain and that
would fail silently in the direction of no alarm. What makes the risk tolerable
is who receives it and when: a deploy is a thing an operator starts
deliberately, so any mail lands while the person who caused it is watching, and
`var.alarm_email` goes to one mailbox rather than to a rota being paged awake.
Chosen on 2026-09-21 in #571.

## Consequences

The first few deploys after this applies are the measurement, and they are worth
watching rather than assuming. If they mail every time, `evaluation_periods` and
`datapoints_to_alarm` on `aws_cloudwatch_metric_alarm.fleet_below_floor` are the
two numbers to move, and this paragraph is what says what moving them costs; the
comment above the resource points here, because a person retuning an alarm reads
the alarm rather than this file. A recurring known false positive is how people
learn to ignore an alarm, so if releases ever become frequent enough that the
deploy mail outnumbers the real mail, this stops being the right trade whatever
the sample count turns out to be. DEPLOYMENT.md section 8 warns the operator
that a deploy may mail, which is the other half of making it tolerable: an
alarm nobody was warned about is indistinguishable from a broken one. The
thresholds in `alarms.tf` are a starting point rather than a measurement in
general, and this is the only one with a predicted false positive rather than a
guess at a real one. The two 5XX alarms carry
`treat_missing_data = "notBreaching"` for a different reason that is not a
trade-off and so is not recorded here: the load balancer reports
`HTTPCode_ELB_5XX_Count` only when it is nonzero and reports neither 5XX metric
when no requests are flowing, so the default would send a recovery mail for the
first stray error after a quiet night.
