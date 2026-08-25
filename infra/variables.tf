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
  description = "RDS instance class (Graviton/arm64)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS allocated storage in GB."
  type        = number
  default     = 20
}

variable "container_cpu" {
  description = "Fargate task CPU units (256 = 0.25 vCPU)."
  type        = number
  default     = 256
}

variable "container_memory" {
  description = "Fargate task memory in MB."
  type        = number
  default     = 512
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

variable "email_review_inbox" {
  description = "Address that receives the notification when a project is submitted for review. Distinct from email_reply_to even where the address matches: one is where replies land, the other is who reviews submissions. Empty disables the submission email."
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
