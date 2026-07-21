# Infrastructure (Terraform)

Provisions the AWS deployment for the EECS Capstone app in **us-west-2**:
a VPC (public app subnets + private ALB/RDS subnets, no NAT Gateway),
an internal ALB fronted by **CloudFront VPC origins**, an arm64 **Fargate**
service, **RDS** Postgres, a private **S3** assets bucket served via a second
CloudFront distribution (OAC), ECR, IAM (task/execution roles + a GitHub OIDC
deploy role), and Secrets Manager / SSM config.

Email is not provisioned yet: the app runs with `EMAIL_TRANSPORT=console`
(verification/reset links go to CloudWatch logs, not real inboxes). Add SES
(or another provider) later and flip `EMAIL_TRANSPORT` back in `infra/ecs.tf`.

See the full design in `../.claude/plans/` (the approved deployment plan).

## First-time setup

1. **Remote state (once):** create a private, versioned, encrypted S3 bucket
   (e.g. `cs-capstone-tfstate`), then uncomment the `backend "s3"` block in
   `providers.tf`. State holds generated DB/auth secrets, so keep it private.
2. `cp terraform.tfvars.example terraform.tfvars` and fill in `github_owner`
   and `github_repo`.
3. `terraform init`
4. `terraform apply`
   - The `aws_cloudfront_vpc_origin` resource takes **15-30+ minutes** to
     create. This is expected, not a hang.
   - The ECS service comes up at `desired_count = 0` (no image exists yet).

## After apply

- Set the real GitHub OAuth client secret:
  `aws --profile aws-capstone1 secretsmanager put-secret-value --secret-id cs-capstone/github-client-secret --secret-string '<secret>'`
- Point the GitHub OAuth app callback at the `app_url` output.
- Run the **Deploy** GitHub Actions workflow to build/push the first image,
  migrate, and scale the service to 1.

## Naming and tagging convention

In a shared account, every resource is associated with this project two ways:

- **Tags:** the provider's `default_tags` stamps `Project`, `Environment`,
  `ManagedBy`, and `Repository` onto every taggable resource automatically.
  Filter the AWS console, Resource Groups, or Cost Explorer by `Project =
  cs-capstone` to see (or bill) only this project. Most resources also carry an
  explicit `Name` tag for a readable console listing.
- **Names:** every resource name is prefixed with `var.project` (for example
  `cs-capstone-alb`, `cs-capstone-ecs-task`). The cluster, service, ECR repo,
  and task family are named exactly `cs-capstone`.

To rename the project, change `var.project`. Note that the deploy workflow
(`.github/workflows/deploy.yml`, the `PROJECT` env) and `DEPLOYMENT.md` hardcode
`cs-capstone` for the cluster/service/ECR/secret/SSM names, so update those to
match if you change it.

## Notes

- `terraform validate` / `plan` are safe; `apply` creates billable resources
  (ALB, RDS, Fargate, CloudFront). Rough cost ~$40-50/mo.
- The deploy workflow owns ECS task-definition revisions and `desired_count`
  (the service `ignore_changes` them), so re-running `apply` won't fight CI.
