resource "aws_lb" "app" {
  name               = "${var.project}-alb"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.private[*].id

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
        { name = "AI_REVIEW_LIMIT_PER_DAY", value = var.ai_review_limit_per_day },
        { name = "BEDROCK_SCOPE_REASONING_EFFORT", value = var.bedrock_scope_reasoning_effort },
        { name = "AI_SCOPE_LIMIT_PER_HOUR", value = var.ai_scope_limit_per_hour },
        { name = "AI_SCOPE_LIMIT_PER_DAY", value = var.ai_scope_limit_per_day },
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
        # Recipient of the project submission notice. Unlike EMAIL_FROM this is
        # a destination, so it needs no SES identity, and unlike EMAIL_REPLY_TO
        # it is read by the app rather than stamped on outgoing headers.
        { name = "EMAIL_REVIEW_INBOX", value = var.email_review_inbox },
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

  # The deploy workflow owns image rollouts and scaling.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.http]

  tags = { Name = var.project }
}
