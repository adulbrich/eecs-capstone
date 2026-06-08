# DATABASE_URL is assembled from the RDS endpoint and the generated password
# so the app can consume a single connection-string secret.
resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.project}/database-url"

  tags = { Name = "${var.project}-database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}"
}

# Better Auth signing secret (generated; rotate freely).
resource "random_password" "better_auth" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "better_auth_secret" {
  name = "${var.project}/better-auth-secret"

  tags = { Name = "${var.project}-better-auth-secret" }
}

resource "aws_secretsmanager_secret_version" "better_auth_secret" {
  secret_id     = aws_secretsmanager_secret.better_auth_secret.id
  secret_string = random_password.better_auth.result
}

# GitHub OAuth client secret. Seeded with a placeholder; set the real value
# after apply (CLI or console). `ignore_changes` keeps Terraform from
# reverting that manual update.
resource "aws_secretsmanager_secret" "github_client_secret" {
  name = "${var.project}/github-client-secret"

  tags = { Name = "${var.project}-github-client-secret" }
}

resource "aws_secretsmanager_secret_version" "github_client_secret" {
  secret_id     = aws_secretsmanager_secret.github_client_secret.id
  secret_string = "REPLACE_ME_AFTER_APPLY"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# The assets CloudFront base URL is needed at image *build* time (it is baked
# into the client bundle via VITE_STORAGE_PUBLIC_BASE). The deploy workflow
# reads it from here and passes it as a Docker build arg.
resource "aws_ssm_parameter" "assets_public_base" {
  name  = "/${var.project}/ASSETS_PUBLIC_BASE"
  type  = "String"
  value = "https://${aws_cloudfront_distribution.assets.domain_name}"

  tags = { Name = "${var.project}-assets-public-base" }
}
