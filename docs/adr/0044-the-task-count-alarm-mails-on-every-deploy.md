# The task-count alarm mails on every deploy, and that is accepted

`infra/alarms.tf` alarms when `ECS/ContainerInsights` `RunningTaskCount` is
below `var.app_min_tasks` for three consecutive one-minute periods, which is
the threshold #571 specified, and that condition is met by every ordinary
deploy rather than only by an outage.
[ADR-0043](./0043-a-deploy-dips-rather-than-doubles.md) caps a deploy at the
desired count, so ECS stops a task before starting its replacement and a fleet
of three sits at two for about three minutes per task, three tasks in sequence.
Roughly nine minutes below the floor, every release. The alternatives were
weighed and each one buys quiet by giving up coverage that matters more.
Raising `datapoints_to_alarm` past the dip means the alarm no longer catches a
fleet that has been down for eight minutes, which is the case it exists for.
Alarming on zero tasks instead catches a total outage and misses two of three
tasks crash-looping, which is the shape a bad image actually fails in and which
the circuit breaker in `infra/ecs.tf` does not always reach. Suppressing the
alarm for the duration of a deploy needs a second mechanism, in the deploy
workflow, that nobody would maintain and that would itself fail silently in the
direction of no alarm. What makes the noise tolerable rather than merely
cheapest is who receives it and when: a deploy is a thing an operator starts
deliberately, so the mail lands while the person who caused it is watching, and
`var.alarm_email` goes to one mailbox rather than to a rota being paged awake.
The honest cost is that this is a recurring known false positive, and known
false positives are how people learn to ignore an alarm, so if releases ever
become frequent enough that the deploy mail outnumbers the real one, this stops
being the right trade. Chosen on 2026-09-21 in #571.

## Consequences

`evaluation_periods` and `datapoints_to_alarm` on
`aws_cloudwatch_metric_alarm.fleet_below_floor` are the two numbers to move,
and the comment above the resource says so, because a person retuning an alarm
reads the alarm rather than this file. The thresholds in `alarms.tf` are a
starting point rather than a measurement in general, and this one is the only
one with a predicted false positive rather than a guess at a real one. The two
5XX alarms carry `treat_missing_data = "notBreaching"` for a different reason
that is not a trade-off and so is not recorded here: the load balancer reports
`HTTPCode_ELB_5XX_Count` only when it is nonzero and reports neither 5XX metric
when no requests are flowing, so the default would send a recovery mail for the
first stray error after a quiet night. Retuning this alarm does not require
retuning those. DEPLOYMENT.md section 8 tells the operator to expect the deploy
mail, which is the other half of making it tolerable: an alarm nobody was
warned about is indistinguishable from a broken one.
