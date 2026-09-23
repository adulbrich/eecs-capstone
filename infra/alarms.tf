# Alarms on the five numbers that have gone bad in production, or would have
# been the first sign that something had. CloudWatch has recorded every one of
# them since the account was built and told nobody: before this file the only
# alarms on the account were the two Application Auto Scaling creates for its
# own CPU policy, which exist to move `desired_count` and mail no one. The
# 2026-09-21 load test found the connection pool pinned at 59 of 60 with
# session lookups failing, and the only reason anybody knew is that a person
# happened to be watching the metric (#571).
#
# Thresholds here are a starting point rather than a measurement. Each one is
# set above what a normal month produces and below what the incident it is
# named for produced, which is the most that can be said before the first time
# one fires. Retune them in place; nothing else reads these numbers.
#
# Not covered here: the AI writer failures (#548), which want a metric filter
# on the log group before they are a metric at all.

# One topic for all five. Splitting by severity would be premature: there is
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
# fixed. Named once rather than ten times so that "both ways, one topic" is a
# single fact rather than five copies to keep in step.
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
