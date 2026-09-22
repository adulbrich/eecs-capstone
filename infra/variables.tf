variable "project" {
  description = "Project name; used as a prefix for resource names."
  type        = string
  default     = "eecs-capstone"
}

variable "environment" {
  description = "Deployment environment."
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS region for the app, RDS, S3, and ALB."
  type        = string
  default     = "us-west-2"
}

variable "domain_name" {
  description = "Custom hostname served by the app CloudFront distribution."
  type        = string
  default     = "capstone.eecs.oregonstate.edu"
}

variable "certificate_domain" {
  description = "DomainName of the ACM certificate covering var.domain_name. The certificate is created and DNS-validated out of band because the eecs.oregonstate.edu zone is managed by OSU, not by this configuration."
  type        = string
  default     = "*.eecs.oregonstate.edu"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "az_count" {
  description = "Number of Availability Zones (>= 2 required for the ALB and RDS subnet group)."
  type        = number
  default     = 2
}

variable "db_name" {
  description = "Postgres database name."
  type        = string
  default     = "eecs_capstone"
}

variable "db_username" {
  description = "Postgres master username."
  type        = string
  default     = "app"
}

variable "db_instance_class" {
  description = "RDS instance class (Graviton/arm64). Sized by connections rather than by CPU: t4g.micro peaked at 6.6% CPU, but its 107 usable connections cannot hold four app tasks at their pool maximum during a deploy. t4g.small has 2 GiB and 220. See ADR-0035."
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GB."
  type        = number
  default     = 20
}

variable "access_log_retention_days" {
  description = "How long ALB and CloudFront access logs are kept. These hold the full client IP of every visitor, so this is a privacy control and the lifecycle rule deletes rather than archives. Thirty matches the CloudWatch log group."
  type        = number
  default     = 30
}

variable "container_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "container_memory" {
  description = "Fargate task memory in MB. At 256 CPU units Fargate accepts 512, 1024 or 2048. Raised to 1024 because memory, not CPU, is the binding resource: it peaked at 44.7% of 512 MB with almost no concurrent users, and SSR concurrency is what 500 students add. See ADR-0035."
  type        = number
  default     = 1024
}

variable "app_min_tasks" {
  description = "Floor for the app service. Three because the fleet has to be big enough before the students arrive: the #524 load test measured two tasks absorbing 26 requests per second against a term start burst of about 42, and measured the scaler arriving minutes after a burst that lasts two. Two rather than one was the original floor, so that a task crash is not an outage while ECS replaces it, and that still holds underneath. See ADR-0040."
  type        = number
  default     = 3
}

variable "app_max_tasks" {
  description = "Ceiling for the app service. Four is what the database connection budget allows: a deploy replaces tasks one at a time (deployment_maximum_percent 100 in ecs.tf), so four is also the most tasks that ever run at once, holding 200 connections, which with the one-off script reservation is 210 of the instance's 220. Raising it means a bigger instance or a smaller pool, not just a bigger number, and `src/lib/__tests__/db-pool.test.ts` reads this default and the deploy percentage and fails if the budget disagrees with either. See ADR-0034 and ADR-0043."
  type        = number
  default     = 4
}

variable "app_scale_target_cpu" {
  description = "Average CPU percentage the app service scales to hold. One task absorbs roughly 50 requests per second at 100%, so 50 starts adding a task at about 25 requests per second."
  type        = number
  default     = 50
}

variable "app_port" {
  description = "Port the app container listens on."
  type        = number
  default     = 3000
}

variable "github_owner" {
  description = "GitHub org/user that owns the repo (for the OIDC deploy role)."
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (for the OIDC deploy role trust policy)."
  type        = string
}

variable "email_reply_to" {
  description = "Reply-To address for outbound mail. Empty means replies land on the unattended noreply@ mailbox. It is not part of DKIM alignment, so it need not be a verified identity or even sit on the sending domain, which is why an ordinary OSU mailbox works here."
  type        = string
  default     = "eecs-capstone@oregonstate.edu"
}

variable "email_staff_inbox" {
  description = "The one mailbox every email addressed to staff goes to, the project submission notice today. Distinct from email_reply_to even where the address matches: one is where replies land, the other is who acts on what the app reports. Required under EMAIL_TRANSPORT=ses: the app refuses to boot without it."
  type        = string
  default     = "eecs-capstone@oregonstate.edu"
}

variable "github_client_id" {
  description = "GitHub OAuth app client ID (not secret). The client secret lives in Secrets Manager."
  type        = string
  default     = ""
}

# Defaulted here rather than left empty for terraform.tfvars to fill, unlike
# github_client_id above. That file is gitignored, so an empty default reaches a
# fresh checkout as an empty ONID_CLIENT_ID in the task definition, and the
# failure surfaces as an Entra error at the token exchange rather than as
# anything this codebase logs. The value is public and fixed for the life of the
# registration, so it belongs in version control next to the discovery URL it
# has to stay in step with.
variable "onid_client_id" {
  description = "ONID (Entra ID) application client ID (not secret). The client secret lives in Secrets Manager."
  type        = string
  default     = "d551d87a-b608-46a6-9fc3-a8b6bd56a5df"
}

# Must name the tenant by GUID. The app derives the expected token issuer from
# this value and refuses any token that does not match, and Entra always issues
# the GUID form even though it will resolve a discovery URL built on a domain
# name. A domain-shaped value here refuses every sign-in.
variable "onid_discovery_url" {
  description = "OIDC discovery document for the Oregon State Entra ID tenant. Tenant must be named by GUID."
  type        = string
  default     = "https://login.microsoftonline.com/ce6d05e1-3c5e-4d62-87a8-4c4a2713c113/v2.0/.well-known/openid-configuration"
}

variable "deploy_branch" {
  description = "Branch the Deploy workflow runs from; the OIDC role trust is scoped to this ref."
  type        = string
  default     = "main"
}

variable "bedrock_region" {
  description = "Region hosting the Bedrock model (kept independent of var.region)."
  type        = string
  default     = "us-west-2"
}

variable "bedrock_model_id" {
  description = "Bedrock model ID for AI project review, as named on the bedrock-mantle endpoint (no us./global. prefix)."
  type        = string
  default     = "openai.gpt-5.6-luna"
}

variable "bedrock_reasoning_effort" {
  description = "Reasoning budget for AI project review: none, low, medium, high, xhigh, or max."
  type        = string
  default     = "medium"
}

# The sign-in attempt counter (#552, ADR-0039). Per (account, viewer address)
# pair, not per address alone: per address cannot protect a credential behind
# campus NAT, and per account alone would let anyone lock a stranger out.
# Retunable without a deploy, which is why these are variables rather than
# literals in src/lib/sign-in-limits.ts. A value of 0, a negative or a typo
# falls back to the code default rather than refusing every sign-in.
variable "sign_in_attempt_window_minutes" {
  description = "How far back failed sign-ins are counted, in minutes."
  type        = string
  default     = "15"
}

variable "sign_in_soft_limit" {
  description = "Failures in the window before the short refusal."
  type        = string
  default     = "5"
}

variable "sign_in_soft_delay_seconds" {
  description = "How long the short refusal lasts, in seconds."
  type        = string
  default     = "60"
}

variable "sign_in_hard_limit" {
  description = "Failures in the window before the longer refusal."
  type        = string
  default     = "10"
}

variable "sign_in_hard_delay_seconds" {
  description = "How long the longer refusal lasts, in seconds."
  type        = string
  default     = "900"
}

variable "verification_mail_window_minutes" {
  description = "How far back verification and duplicate-sign-up mail is counted per recipient, in minutes."
  type        = string
  default     = "60"
}

variable "sign_in_code_limit" {
  description = "Emailed sign-in codes allowed to one recipient in the same window. This is the brute force control as well as a mail cap, because Better Auth's per-code attempt count resets on every resend; see src/lib/verification-mail-limits.ts."
  type        = string
  default     = "5"
}

variable "duplicate_notice_limit" {
  description = "Duplicate-sign-up notices allowed to one recipient in the same window. Metered apart from verification links so a squatter cannot spend the owner's warning; see src/lib/verification-mail-limits.ts."
  type        = string
  default     = "2"
}

variable "verification_mail_limit" {
  description = "Messages allowed to one recipient inside that window. Above what a person whose link expired would legitimately ask for; see src/lib/verification-mail-limits.ts."
  type        = string
  default     = "3"
}

variable "ai_review_limit_per_hour" {
  description = "Per-user hourly ceiling on AI project reviews."
  type        = string
  default     = "10"
}

variable "ai_review_limit_per_day" {
  description = "Per-user daily ceiling on AI project reviews."
  type        = string
  default     = "40"
}

variable "bedrock_scope_reasoning_effort" {
  description = "Reasoning effort for the staff scope assessment. Higher than the review's: a verdict, not an edit."
  type        = string
  default     = "high"
}

variable "bedrock_social_summary_reasoning_effort" {
  description = "Reasoning effort for the social summary. One of none, low, medium, high, xhigh, max; Mantle rejects the OpenAI value minimal outright."
  type        = string
  default     = "medium"
}

variable "bedrock_social_summary_enabled" {
  description = "Kill switch for the social summary. Plumbed, unlike the embeddings one, because this is the only model call that runs without a human pressing anything: it fires on every publish, archive and edit of a live project, so stopping it must not wait on a terraform apply."
  type        = string
  default     = "true"
}

variable "ai_social_summary_limit_per_hour" {
  description = "Per-user hourly ceiling on staff social summary rewrites. Meters the Regenerate button only; the automatic path is not counted."
  type        = string
  default     = "20"
}

variable "ai_social_summary_limit_per_day" {
  description = "Per-user daily ceiling on staff social summary rewrites."
  type        = string
  default     = "60"
}

variable "ai_scope_limit_per_hour" {
  description = "Per-user hourly ceiling on scope assessments. Metered apart from AI reviews."
  type        = string
  default     = "10"
}

variable "ai_scope_limit_per_day" {
  description = "Per-user daily ceiling on scope assessments."
  type        = string
  default     = "40"
}

variable "bedrock_embedding_model_id" {
  description = "Bedrock model id used for project and interest embeddings"
  type        = string
  default     = "amazon.titan-embed-text-v2:0"
}

variable "bedrock_embedding_dimensions" {
  description = "Embedding vector size; must match the vector(N) column width"
  type        = string
  default     = "1024"
}

variable "alarm_email" {
  description = "Where CloudWatch alarm mail goes (infra/alarms.tf). The default is the shared capstone mailbox, the same address email_reply_to and email_staff_inbox already default to, and it lives here rather than in terraform.tfvars for the reason DEPLOYMENT.md 9.6 gives about that file: it is gitignored, so a value set there would not reach anyone else's deployment. Defaulted rather than required because an alarm topic nobody is subscribed to is worse than no alarm, and a default that names a mailbox a person actually reads cannot be left unset by accident. Note this is SNS email, not SES: the address needs no SES identity, but AWS does mail it a confirmation link on the first apply and delivers nothing until somebody clicks it."
  type        = string
  default     = "eecs-capstone@oregonstate.edu"
}
