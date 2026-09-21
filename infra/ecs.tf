resource "aws_lb" "app" {
  name               = "${var.project}-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.private[*].id

  # The AWS default, written down because it is half of a pair. The load
  # balancer holds an idle connection to a task for this long and reuses it;
  # the task has to outlast it, or the balancer dispatches onto a connection
  # Node has already closed and the student gets a 502 (#545). The other half
  # is KEEP_ALIVE_TIMEOUT_MS in src/lib/_internal/keep-alive-timeout.ts, and
  # `src/lib/__tests__/keep-alive-timeout.test.ts` reads this line to hold the
  # two in the right order. Lowering it is not the way to fix that pair: this
  # also bounds the wait for a target's first byte, and the load test measured
  # a p50 of 4.12 s under saturation, so a short one trades 502s for 504s.
  idle_timeout = 60

  # Hand X-Forwarded-For to the task exactly as CloudFront sent it. The default
  # is "append", and what the ALB appends is the CloudFront EDGE server's public
  # address, not the VPC origin ENI (AWS documents this under "Client IP
  # addresses" for custom origins). So the last entry was an edge server, Better
  # Auth read it as the viewer, and the rate limiter keyed on CloudFront rather
  # than on a person: diluted across many edges for one viewer, and firing on
  # strangers when it fired (#535).
  #
  # Under "preserve" the last entry is CloudFront's own append, which is
  # documented and unconditional: the viewer address taken from the TCP
  # connection. Anything a viewer prepends sits to its left and is never
  # reached. TRUSTED_PROXY_CIDR below must still be non-empty for that walk to
  # happen at all; see the comment there.
  #
  # Not a change in forgery risk, despite how it reads. Under `append` an
  # in-VPC caller sending `XFF: 1.2.3.4` produced `1.2.3.4, <its own 10.x>`, and
  # the walk skipped the trusted 10.x and believed 1.2.3.4 anyway. Anything
  # inside the VPC could forge a viewer before this and can after it. What
  # bounds that is the ALB being internal and the only things in the VPC being
  # this app's own tasks, not the header mode.
  xff_header_processing_mode = "preserve"

  # Every request that reached the origin, which CloudWatch metrics can only
  # count in aggregate. The bucket, its retention and the delivery grant are
  # in infra/logging.tf; the prefix is what the bucket policy scopes to.
  access_logs {
    bucket  = aws_s3_bucket.access_logs.id
    prefix  = "alb"
    enabled = true
  }

  # ELB writes a test object the moment logging is enabled and fails the
  # update if it cannot, so the grant has to exist first. Terraform does not
  # infer this from the bucket reference above.
  depends_on = [aws_s3_bucket_policy.access_logs]

  tags = { Name = "${var.project}-alb" }
}

resource "aws_lb_target_group" "app" {
  name        = "${var.project}-tg"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    path                = "/api/healthz"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = { Name = "${var.project}-tg" }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_ecs_cluster" "main" {
  name = var.project

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = var.project }
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.project}"
  retention_in_days = 30

  tags = { Name = "${var.project}-logs" }
}

# Bootstrap task definition. Points at a `:bootstrap` tag that does not exist
# yet; the deploy workflow registers real revisions (and the service ignores
# task_definition / desired_count, so it owns them thereafter).
resource "aws_ecs_task_definition" "app" {
  family                   = var.project
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.container_cpu
  memory                   = var.container_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name         = "app"
      image        = "${aws_ecr_repository.app.repository_url}:bootstrap"
      essential    = true
      portMappings = [{ containerPort = var.app_port, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.app_port) },
        # better-auth derives trustedOrigins from this value and reads it
        # before it will consider x-forwarded-host, so trustHost does not
        # cover a hostname that disagrees with it: requests from any other
        # origin fail the origin check with INVALID_ORIGIN.
        { name = "BETTER_AUTH_URL", value = "https://${var.domain_name}" },
        # Required, and required to be NON-EMPTY, which is the whole of what it
        # now does. With an empty trusted list Better Auth believes only a
        # single-entry header and every viewer collapses into one bucket (#519);
        # with a non-empty one it walks X-Forwarded-For from the right and takes
        # the first entry outside the range, which under `preserve` on the load
        # balancer above is CloudFront's append, the viewer.
        #
        # It no longer names a hop that is skipped. It used to claim to be the
        # CloudFront VPC origin ENI; that ENI is not in the chain, so this value
        # matches nothing and skips nothing (#535). Keep it set to the VPC range
        # anyway: it is a real CIDR, it can never match a viewer, and a
        # value that could match one would make a viewer invisible. The app
        # refuses to boot without it, so it reaches the task by apply *then*
        # deploy, like EMAIL_TRANSPORT.
        { name = "TRUSTED_PROXY_CIDR", value = var.vpc_cidr },
        { name = "GITHUB_CLIENT_ID", value = var.github_client_id },
        { name = "ONID_CLIENT_ID", value = var.onid_client_id },
        # The tenant discovery document. An env var rather than a literal in
        # src/lib/auth.ts so a tenant change, or a test tenant if UIT ever
        # provide one, is a variable and not a deploy.
        { name = "ONID_DISCOVERY_URL", value = var.onid_discovery_url },
        { name = "S3_BUCKET", value = aws_s3_bucket.assets.bucket },
        { name = "S3_REGION", value = var.region },
        { name = "BEDROCK_REGION", value = var.bedrock_region },
        { name = "BEDROCK_MODEL_ID", value = var.bedrock_model_id },
        { name = "BEDROCK_REASONING_EFFORT", value = var.bedrock_reasoning_effort },
        { name = "AI_REVIEW_LIMIT_PER_HOUR", value = var.ai_review_limit_per_hour },
        # The sign-in attempt counter (#552). Unset falls back to the code
        # defaults in src/lib/sign-in-limits.ts, so these exist to be retuned
        # without a deploy rather than to make the control work.
        { name = "SIGN_IN_ATTEMPT_WINDOW_MINUTES", value = var.sign_in_attempt_window_minutes },
        { name = "SIGN_IN_SOFT_LIMIT", value = var.sign_in_soft_limit },
        { name = "SIGN_IN_SOFT_DELAY_SECONDS", value = var.sign_in_soft_delay_seconds },
        { name = "SIGN_IN_HARD_LIMIT", value = var.sign_in_hard_limit },
        { name = "SIGN_IN_HARD_DELAY_SECONDS", value = var.sign_in_hard_delay_seconds },
        { name = "AI_REVIEW_LIMIT_PER_DAY", value = var.ai_review_limit_per_day },
        { name = "BEDROCK_SCOPE_REASONING_EFFORT", value = var.bedrock_scope_reasoning_effort },
        { name = "BEDROCK_SOCIAL_SUMMARY_REASONING_EFFORT", value = var.bedrock_social_summary_reasoning_effort },
        { name = "BEDROCK_SOCIAL_SUMMARY_ENABLED", value = var.bedrock_social_summary_enabled },
        { name = "AI_SCOPE_LIMIT_PER_HOUR", value = var.ai_scope_limit_per_hour },
        { name = "AI_SCOPE_LIMIT_PER_DAY", value = var.ai_scope_limit_per_day },
        { name = "AI_SOCIAL_SUMMARY_LIMIT_PER_HOUR", value = var.ai_social_summary_limit_per_hour },
        { name = "AI_SOCIAL_SUMMARY_LIMIT_PER_DAY", value = var.ai_social_summary_limit_per_day },
        { name = "BEDROCK_EMBEDDING_MODEL_ID", value = var.bedrock_embedding_model_id },
        { name = "BEDROCK_EMBEDDING_DIMENSIONS", value = var.bedrock_embedding_dimensions },
        # Real outbound mail through SES. Both preconditions are met: the
        # domain identity reads VerifiedForSendingStatus=true with DKIM
        # SUCCESS, and the account has left the sandbox
        # (ProductionAccessEnabled=true), so SES will deliver to recipients
        # who are not themselves verified identities.
        #
        # EMAIL_FROM below is not optional under this value. getEmailSender()
        # runs at module scope in src/lib/auth.ts, and createSesEmailSender
        # throws without it, so the pair arriving separately would fail the
        # app's boot rather than just its email. Terraform sets them in one
        # revision, which is why the cutover is apply *then* deploy and never
        # a hand-edit of this variable in the console.
        { name = "EMAIL_TRANSPORT", value = "ses" },
        # Required under EMAIL_TRANSPORT=ses; see the note above. The From
        # domain must match the verified identity or DKIM alignment fails, so
        # both derive from var.domain_name.
        { name = "EMAIL_FROM", value = "noreply@${var.domain_name}" },
        # Where replies land, since noreply@ has no mailbox. Plays no part in
        # DKIM alignment, unlike EMAIL_FROM above, so it needs no SES identity
        # and sits on oregonstate.edu rather than the sending domain. The app
        # treats "" as unset and omits the header entirely.
        { name = "EMAIL_REPLY_TO", value = var.email_reply_to },
        # The one mailbox every email addressed to staff goes to. Unlike
        # EMAIL_FROM this is a destination, so it needs no SES identity, and
        # unlike EMAIL_REPLY_TO it is read by the app rather than stamped on
        # outgoing headers. Required under ses like EMAIL_FROM: the app refuses
        # to boot without it, so it ships in the same revision as the transport.
        { name = "EMAIL_STAFF_INBOX", value = var.email_staff_inbox },
        # src/lib/email/config.ts falls back to us-east-1. The identity
        # lives in var.region, and the mismatch surfaces only as an opaque
        # "email address not verified" error, so pin it explicitly.
        { name = "SES_REGION", value = var.region },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
        { name = "BETTER_AUTH_SECRET", valueFrom = aws_secretsmanager_secret.better_auth_secret.arn },
        { name = "GITHUB_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.github_client_secret.arn },
        { name = "ONID_CLIENT_SECRET", valueFrom = aws_secretsmanager_secret.onid_client_secret.arn },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.app.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "app"
        }
      }
    }
  ])

  tags = { Name = var.project }
}

resource "aws_ecs_service" "app" {
  name            = var.project
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 0
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.app_port
  }

  # A failed deploy rolls back to the previous task definition instead of
  # leaving the service trying to place a task that cannot start. Without
  # this, a bad revision loops until someone notices; the old task keeps
  # serving throughout either way, so the rollback costs nothing to enable.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # The deploy workflow owns image rollouts, and Application Auto Scaling
  # below owns desired_count. Both write it out of band, which is what this
  # ignore is for.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.http]

  tags = { Name = var.project }
}

# Application Auto Scaling owns desired_count from here on; the service
# ignores drift on it. The service-linked role is created by AWS on first
# use, so no IAM resource is needed. Scaling is free; only the tasks cost.
resource "aws_appautoscaling_target" "app" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.app_min_tasks
  max_capacity       = var.app_max_tasks

  tags = { Name = "${var.project}-scaling" }
}

# CPU rather than memory. A Node process grows its heap to fill what it is
# given and returns it slowly, so MemoryUtilization ratchets up and makes a
# poor scale-in signal: the service would add tasks and never remove them.
# CPU tracks request work directly. The asymmetric cooldowns mean a spike is
# answered in a minute and the extra tasks linger ten, so a bursty hour does
# not thrash.
resource "aws_appautoscaling_policy" "app_cpu" {
  name               = "${var.project}-cpu-target"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  resource_id        = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension

  target_tracking_scaling_policy_configuration {
    target_value       = var.app_scale_target_cpu
    scale_out_cooldown = 60
    scale_in_cooldown  = 600

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
