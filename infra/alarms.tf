# Alarms on the six numbers that have gone bad in production, or would have
# been the first sign that something had. CloudWatch has recorded every one of
# them since the account was built and told nobody: before this file the only
# alarms on the account were the two Application Auto Scaling creates for its
# own CPU policy, which exist to move `desired_count` and mail no one. The
# 2026-09-21 load test found the connection pool pinned at 59 of 60 with
# session lookups failing, and the only reason anybody knew is that a person
# happened to be watching the metric (#571). The last alarm is the exception:
# CloudWatch held only the log lines for it, and the metric filter beside it is
# what makes them a number (#548).
#
# Thresholds here are a starting point rather than a measurement. Each one is
# set above what a normal month produces and below what the incident it is
# named for produced, which is the most that can be said before the first time
# one fires. Retune them in place; nothing else reads these numbers.

# One topic for all six. Splitting by severity would be premature: there is
# one recipient and every alarm below means somebody should look.
resource "aws_sns_topic" "alarms" {
  name = "${var.project}-alarms"

  tags = { Name = "${var.project}-alarms" }
}

# AWS mails a confirmation link the moment this is created and the subscription
# delivers nothing until somebody clicks it. Terraform reports the subscription
# as created either way, with `pending_confirmation` in its state, so a green
# apply is not evidence that alarm mail works. DEPLOYMENT.md section 8 carries
# the click and the `set-alarm-state` check that proves delivery end to end.
#
# Protocol `email` rather than `email-json` because a person reads it. This is
# SNS email and not SES, despite `infra/ses.tf` sitting next door: the address
# needs no SES identity and the send does not touch the domain identity or its
# reputation. It defaults to the shared capstone mailbox, the same one
# `email_reply_to` and `email_staff_inbox` already default to.
resource "aws_sns_topic_subscription" "alarm_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Every alarm below notifies on the way in and on the way out, so a recovery is
# mailed too. Without the second one the only signal is the opening mail, and an
# alarm that has quietly gone back to OK reads exactly like one nobody has
# fixed. Named once rather than twelve times so that "both ways, one topic" is a
# single fact rather than six copies to keep in step.
locals {
  alarm_notifications = [aws_sns_topic.alarms.arn]
}

# Requests the load balancer itself failed: no target answered, the target
# closed the connection, or the request never reached the app. Distinct from
# the next alarm, which is the app answering 5XX on its own.
#
# `treat_missing_data` is "notBreaching" on both 5XX alarms, which the issue did
# not ask for and which is load-bearing. Two AWS reporting rules put this metric
# in CloudWatch's "missing" state most of the time. The narrow one is this
# metric's own criterion, "There is a nonzero value", so a healthy fleet
# publishes nothing here at all. The broad one covers the alarm below as well:
# "If there are no requests flowing through the load balancer or no data for a
# metric, the metric is not reported", which is every quiet night. Under the
# default ("missing") the alarm sits in INSUFFICIENT_DATA, and the first stray
# 5XX publishes a 1, which is below the threshold, which transitions it to OK
# and fires `ok_actions`. That is a recovery mail for an alarm that never
# alarmed, once per stray error. "notBreaching" starts it in OK and keeps it
# there, so the only transition is a real one.
resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name        = "${var.project}-alb-5xx"
  alarm_description = "The load balancer returned more than 5 5XX responses in five minutes, which means it could not get an answer out of the fleet."

  namespace   = "AWS/ApplicationELB"
  metric_name = "HTTPCode_ELB_5XX_Count"
  statistic   = "Sum"

  # Five in five minutes is above the zero the app has run at for a month and
  # below the seven the pre-fix load test produced in four.
  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  # Read from the resource rather than pasted. The `#524` write-ups paste the
  # suffix, and a pasted one is wrong the first time the load balancer is
  # replaced without anybody noticing the alarm stopped measuring anything.
  dimensions = { LoadBalancer = aws_lb.app.arn_suffix }

  alarm_actions = local.alarm_notifications
  ok_actions    = local.alarm_notifications

  tags = { Name = "${var.project}-alb-5xx" }
}

# The app answering 5XX. This is the one that would have caught #519 and the
# 2026-09-17 spike at the time rather than afterwards from the access logs.
resource "aws_cloudwatch_metric_alarm" "app_5xx" {
  alarm_name        = "${var.project}-app-5xx"
  alarm_description = "The app returned more than 5 5XX responses in five minutes."

  namespace   = "AWS/ApplicationELB"
  metric_name = "HTTPCode_Target_5XX_Count"
  statistic   = "Sum"

  comparison_operator = "GreaterThanThreshold"
  threshold           = 5
  period              = 300
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  # Set for the same reason as the alarm above, but not for the same rule, and
  # the difference is worth writing down because it looks like a copy. This
  # metric is "Reported if there are registered targets", so it does publish a
  # zero on a fleet that is up and idle. What it stops publishing is a fleet
  # with no registered targets, and a quiet load balancer with no requests at
  # all. Either gap would otherwise be an INSUFFICIENT_DATA the next single 5XX
  # resolves into an OK mail.
  treat_missing_data = "notBreaching"

  dimensions = { LoadBalancer = aws_lb.app.arn_suffix, TargetGroup = aws_lb_target_group.app.arn_suffix }

  alarm_actions = local.alarm_notifications
  ok_actions    = local.alarm_notifications

  tags = { Name = "${var.project}-app-5xx" }
}

# The failure ADR-0034 and ADR-0043 are both about. 100 is below the 135 three
# tasks can hold now that the pool is 45 (#570), and far above the 7 an idle
# day reaches, so this fires while there is still headroom rather than once
# `acquire` has already started timing out at the instance ceiling of 220.
#
# Maximum rather than Average, because the pool pins for seconds at a time and
# a one-minute average of a burst reads as nothing. Two consecutive minutes so
# a single migration or a one-off script does not mail anybody.
resource "aws_cloudwatch_metric_alarm" "db_connections" {
  alarm_name        = "${var.project}-db-connections"
  alarm_description = "RDS held more than 100 connections for two minutes running, which is the pool approaching the instance ceiling."

  namespace   = "AWS/RDS"
  metric_name = "DatabaseConnections"
  statistic   = "Maximum"

  comparison_operator = "GreaterThanThreshold"
  threshold           = 100
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2

  dimensions = { DBInstanceIdentifier = aws_db_instance.main.identifier }

  alarm_actions = local.alarm_notifications
  ok_actions    = local.alarm_notifications

  tags = { Name = "${var.project}-db-connections" }
}

# The fleet below its floor. Container Insights is already enabled on the
# cluster (`ecs.tf`), which is what publishes this.
#
# `treat_missing_data = "breaching"` because a service at zero tasks publishes
# nothing at all, and that is the outage this alarm exists for. Under the
# default it would go to INSUFFICIENT_DATA and stay silent through exactly the
# case it is named for.
#
# Read the deploy interaction before retuning this. `deployment_maximum_percent`
# is 100 and `deployment_minimum_healthy_percent` is 50 (ADR-0043), so a rolling
# deploy stops a task before starting its replacement and the fleet reads two of
# three while that happens, three times in sequence. Whether that reaches three
# CONSECUTIVE one-minute samples is not known and has not been watched: ADR-0043
# measures a drain, a start and two health checks in wall clock, while this
# counts tasks in RUNNING, which a replacement enters before it is healthy and a
# draining task leaves as soon as it is stopping. So a deploy may trip this, may
# not, or may oscillate across the sampling boundary and send several pairs. It
# is left at the threshold #571 specified because the alternatives cost coverage
# even against the worst of those: raising `datapoints_to_alarm` past the dip
# also stops this catching a fleet that is down for the same minutes, alarming
# on 0 misses two of three tasks crash-looping, and suppressing during a deploy
# needs a second mechanism nobody would maintain. The first few deploys after
# this applies are the measurement. If it mails every time, `evaluation_periods`
# and `datapoints_to_alarm` are the two numbers to move, and ADR-0044 is what
# says what moving them costs.
resource "aws_cloudwatch_metric_alarm" "fleet_below_floor" {
  alarm_name        = "${var.project}-fleet-below-floor"
  alarm_description = "The app service ran fewer than ${var.app_min_tasks} tasks for three minutes running. A rolling deploy can cause this; an outage otherwise."

  namespace   = "ECS/ContainerInsights"
  metric_name = "RunningTaskCount"
  statistic   = "Minimum"

  comparison_operator = "LessThanThreshold"
  threshold           = var.app_min_tasks
  period              = 60
  evaluation_periods  = 3
  datapoints_to_alarm = 3
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.app.name
  }

  alarm_actions = local.alarm_notifications
  ok_actions    = local.alarm_notifications

  tags = { Name = "${var.project}-fleet-below-floor" }
}

# A request queued for a database connection. The app samples pg-pool's
# `waitingCount` every second and logs a minute of samples as one Embedded
# Metric Format line (`startPoolMetrics` in `src/lib/_internal/db-pool.ts`),
# which CloudWatch Logs turns into this metric with no dimensions, so the
# `Maximum` is the worst second on any task. The namespace and metric name are
# the `POOL_METRICS` constants there, and `db-pool.test.ts` fails if the two
# drift apart (#558).
#
# The deliberate replacement for the failed session lookups that were the only
# sign the pool ran out during the #524 load test, which ADR-0042's redaction
# made hard to spot. `db_connections` above sees the instance; this sees the
# queue in front of it, which fills before the instance does whenever one task
# holds all 45 of its own connections.
#
# A queue seen in two consecutive calendar minutes. Each line holds one minute
# of one-second samples, stamped with that minute, so a burst that queues
# within one minute does not mail. Two seconds of queueing that straddle a
# minute boundary do, which is the floor of what this can mean: the rest of
# the range is two full minutes of requests slowed by the pool, failing past
# the 5 s acquire timeout. A queue that forms and drains between two samples is
# not seen at all. A starting point like the others; retune it once
# a term start has been watched. `notBreaching` because a fleet at zero tasks
# publishes nothing here, and `fleet_below_floor` is the alarm for that.
resource "aws_cloudwatch_metric_alarm" "db_pool_waiting" {
  alarm_name        = "${var.project}-db-pool-waiting"
  alarm_description = "Requests queued for a database connection in each of two consecutive minutes, which is the pool running out on at least one task."

  namespace   = "eecs-capstone/db-pool"
  metric_name = "PoolWaiting"
  statistic   = "Maximum"

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  period              = 60
  evaluation_periods  = 2
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_notifications
  ok_actions    = local.alarm_notifications

  tags = { Name = "${var.project}-db-pool-waiting" }
}

# A failed automatic AI write, counted from the app's own log because nothing
# else records one. The background refresh ADR-0053 describes runs after a save
# or publish has committed and catches everything, so a Bedrock outage costs
# the proposer nothing; before this it told nobody either (#548).
#
# A regex, anchored at the start of the line, because a phrase matched anywhere
# can be written by a stranger: Better Auth logs a rejected `callbackURL` or
# `Origin` word for word, so two unauthenticated requests carrying "social
# summary failed" would mail, or hold the alarm in ALARM through a real outage.
# `redactingAuthLogger` collapses newlines, so that text cannot start a line of
# its own either. The syntax has no parentheses, so each `|` alternative
# carries its own `^`. Case sensitive, which is what keeps each failure
# counted once:
#
# - The first two alternatives are `Project refresh for <id>: embedding
#   <outcome>, social summary <outcome>, <n> ms`, the one line `refreshAndLog`
#   in `src/server/_internal/project-refresh.ts` prints per refresh, when
#   either outcome is `failed`. A line with both failed is one event and counts
#   once. A truncated summary reports `failed` through the same line. A task
#   stopped mid-refresh prints nothing, and that write is not counted.
# - The third is the error `refreshInterestsEmbedding` in
#   `project-embeddings.ts` prints, the third automatic writer, which has no
#   refresh line of its own.
#
# The capitalised `Embedding failed for project` and `Social summary failed
# for project` errors are left out on purpose: each is the same failure the
# refresh line already reports, so matching them would count it twice.
# `project-refresh.test.ts` runs this pattern against the line the code prints,
# so rewording either side fails a test instead of quietly zeroing the metric.
# The `aws logs tail` recipe in DEPLOYMENT.md, which lists the lines behind a
# mail, matches looser phrases on purpose and no test checks it, so change it
# in the same commit.
#
# No `default_value`. With one, every unmatched line on the group would publish
# a zero; without it the metric exists only when something failed.
resource "aws_cloudwatch_log_metric_filter" "ai_write_failures" {
  name           = "${var.project}-ai-write-failures"
  log_group_name = aws_cloudwatch_log_group.app.name
  pattern        = "%^Project refresh for \\S+: embedding failed,|^Project refresh for \\S+: embedding [a-z]+, social summary failed,|^Embedding failed for user interests %"

  metric_transformation {
    name      = "AiWriteFailures"
    namespace = "${var.project}/ai-writes"
    value     = "1"
    unit      = "Count"
  }
}

# About fifteen refreshes a day and one failure in the last thirty days, so a
# single failure is the noise a design without retries accepts (a project's
# next save or a sweep puts it right; an interest embedding waits for that
# user's next save, since no sweep covers it) and two in three hours more
# likely has a cause: Bedrock down, or a setting the endpoint refuses, like
# the `minimal` effort that failed every social summary on 2026-09-21 without
# anybody hearing of it (`docs/QUIRKS.md`, Amazon Bedrock). One three-hour
# period rather than three one-hour ones because the question is how many
# failed, not in how many hours any did. The window slides (no
# `evaluation_window` is set), so any two failures within three hours of each
# other mail, wherever the clock hours fall.
#
# `notBreaching` because the filter publishes nothing until something fails,
# so missing data is the healthy state rather than a gap to worry about. It
# also means an OK after ALARM says only that at least three hours passed with
# fewer than two failures, not that anything was fixed: a configuration still
# refused on every call goes OK whenever refreshes are sparse, so read the
# recovery mail that way.
resource "aws_cloudwatch_metric_alarm" "ai_write_failures" {
  alarm_name        = "${var.project}-ai-write-failures"
  alarm_description = "Automatic AI writes (a project embedding, a social summary or an interest embedding) failed at least twice in three hours. The saves that started them succeeded, and each row kept what it had before."

  namespace   = aws_cloudwatch_log_metric_filter.ai_write_failures.metric_transformation[0].namespace
  metric_name = aws_cloudwatch_log_metric_filter.ai_write_failures.metric_transformation[0].name
  statistic   = "Sum"

  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 2
  period              = 10800
  evaluation_periods  = 1
  datapoints_to_alarm = 1
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_notifications
  ok_actions    = local.alarm_notifications

  tags = { Name = "${var.project}-ai-write-failures" }
}
