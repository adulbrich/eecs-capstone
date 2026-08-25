# DATABASE_URL is assembled from the RDS endpoint and the generated password
# so the app can consume a single connection-string secret.
resource "aws_secretsmanager_secret" "database_url" {
  name = "${var.project}/database-url"

  tags = { Name = "${var.project}-database-url" }
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  # The default Postgres 18 parameter group enforces SSL (rds.force_ssl).
  # sslmode=verify-full + the RDS CA bundle (baked into the image at
  # /etc/ssl/certs/rds-global-bundle.pem, see Dockerfile) verifies the
  # server cert instead of just encrypting blind.
  secret_string = "postgresql://${var.db_username}:${random_password.db.result}@${aws_db_instance.main.address}:5432/${var.db_name}?sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem"
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

# ONID (Entra ID) client secret. Same placeholder-then-set-by-hand shape as the
# GitHub secret above, for an additional reason: this value does not originate
# in AWS at all. UIT issue it into an Azure Key Vault
# (kv-engr-coe-vault-caps) and it is copied across by hand. There is no sync
# and there should not be one for a value that changes every two years.
#
# It expires 2028-08-24, does not auto-renew, and UIT do not track expiry dates.
# Whoever sets it should put that date in a shared calendar; renewal is a request
# through the UIT support portal. See docs/ONID-SSO.md.
#
# Use the production secret here. UIT issued a second, separate secret on the
# same client ID for local development, and that one does not belong in AWS.
resource "aws_secretsmanager_secret" "onid_client_secret" {
  name = "${var.project}/onid-client-secret"

  tags = { Name = "${var.project}-onid-client-secret" }
}

resource "aws_secretsmanager_secret_version" "onid_client_secret" {
  secret_id     = aws_secretsmanager_secret.onid_client_secret.id
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
