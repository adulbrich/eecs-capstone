# Three security groups, with cross-referencing rules defined as standalone
# resources to avoid circular dependencies between the groups.

resource "aws_security_group" "alb" {
  name        = "${var.project}-alb"
  description = "Internal ALB; reachable only from within the VPC (CloudFront VPC origin)"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-alb" }
}

resource "aws_security_group" "app" {
  name        = "${var.project}-app"
  description = "Fargate app tasks"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-app" }
}

resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "RDS Postgres; reachable only from the app tasks"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${var.project}-rds" }
}

# The ALB is internal, so the only thing that can reach it is the CloudFront
# VPC-origin ENI, which lives inside the VPC. Scope ingress to the VPC CIDR.
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP from within the VPC (CloudFront VPC origin)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = var.vpc_cidr
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to app tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "App port from the ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.app_port
  to_port                      = var.app_port
  referenced_security_group_id = aws_security_group.alb.id
}

# Egress to the internet for ECR pulls, Bedrock, and the GitHub OAuth token
# exchange (tasks reach the internet via their public IP + IGW).
resource "aws_vpc_security_group_egress_rule" "app_all" {
  security_group_id = aws_security_group.app.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_app" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Postgres from the app tasks only"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.app.id
}
