terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state. Bootstrap the bucket once (see infra/README.md), then
  # uncomment. AWS provider v6 + Terraform 1.10+ use S3-native locking via
  # `use_lockfile`, so no DynamoDB table is required.
  # backend "s3" {
  #   bucket       = "cs-capstone-tfstate"
  #   key          = "prod/terraform.tfstate"
  #   region       = "us-west-2"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

provider "aws" {
  region = var.region

  # Applied to every taggable resource in this configuration. This is the
  # primary way resources are associated with the project in a shared account:
  # filter the console / Cost Explorer / Resource Groups by `Project`.
  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      ManagedBy   = "terraform"
      Repository  = "${var.github_owner}/${var.github_repo}"
    }
  }
}

data "aws_caller_identity" "current" {}
