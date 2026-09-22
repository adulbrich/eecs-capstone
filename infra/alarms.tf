# Alarms on the four numbers that have gone bad in production, or would have
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
# on the log group before they are a metric at all, and the pool acquire wait
# (#558), which does not exist yet and deserves an alarm here when it does.

# One topic for all four. Splitting by severity would be premature: there is
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
# Protocol `email` rather than `email-json` because a person reads it. The
# address is not committed; it comes from `terraform.tfvars`.
resource "aws_sns_topic_subscription" "alarm_email" {
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

# Every alarm below sets `ok_actions` as well as `alarm_actions`, so a recovery
# is mailed too. Without it the only signal is the opening mail, and an alarm
# that has quietly gone back to OK reads exactly like one nobody has fixed.

# Requests the load balancer itself failed: no target answered, the target
# closed the connection, or the request never reached the app. Distinct from
# the next alarm, which is the app answering 5XX on its own.
#
# `treat_missing_data` is "notBreaching", which the issue did not ask for and
# which is load-bearing. ALB publishes the HTTPCode counters only when they are
# nonzero, so on a healthy fleet this metric has no datapoints at all. Under
# the default ("missing") the alarm would sit in INSUFFICIENT_DATA forever, and
# the first stray 5XX would publish a 1, which is below the threshold, which
# transitions the alarm to OK and fires `ok_actions`. That is a recovery mail
# for an alarm that never alarmed, once per stray error. "notBreaching" starts
# it in OK and keeps it there, so the only transition is a real one.
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

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

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
  # Same reason as the alarm above: the counter is not published when it is
  # zero, so the default would mail a recovery for the first single 5XX.
  treat_missing_data = "notBreaching"

  dimensions = { LoadBalancer = aws_lb.app.arn_suffix, TargetGroup = aws_lb_target_group.app.arn_suffix }

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

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

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

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
# deploy stops a task before starting its replacement and the fleet sits at two
# of three for about three minutes per task, three tasks in sequence. Three
# consecutive minutes below the floor is therefore met by every ordinary deploy,
# and this will mail on each one. That is the threshold #571 specified and it is
# left as specified: the alternatives all cost something real. Raising
# `datapoints_to_alarm` past about nine minutes stops the deploy mail and also
# stops this catching a fleet that is down for eight. Alarming on 0 rather than
# the floor catches only a total outage and not the case where two of three
# tasks are crash-looping. Suppressing during a deploy needs a second mechanism
# nobody would maintain. A deploy is a thing an operator starts, so the mail
# arrives while they are watching; if that turns out to be the wrong trade,
# `evaluation_periods` and `datapoints_to_alarm` are the two numbers to move.
resource "aws_cloudwatch_metric_alarm" "fleet_below_floor" {
  alarm_name        = "${var.project}-fleet-below-floor"
  alarm_description = "The app service ran fewer than ${var.app_min_tasks} tasks for three minutes running. Expected during a rolling deploy; an outage otherwise."

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

  alarm_actions = [aws_sns_topic.alarms.arn]
  ok_actions    = [aws_sns_topic.alarms.arn]

  tags = { Name = "${var.project}-fleet-below-floor" }
}
