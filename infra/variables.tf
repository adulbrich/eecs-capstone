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
  default     = "cs_capstone"
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

variable "github_client_id" {
  description = "GitHub OAuth app client ID (not secret). The client secret lives in Secrets Manager."
  type        = string
  default     = ""
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
  description = "Bedrock model ID for AI project review."
  type        = string
  default     = "minimax.minimax-m2.5"
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
