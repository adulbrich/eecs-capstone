# Deploying CS Capstone to AWS

This is the end-to-end runbook for deploying and operating the app on AWS. It
is written so that someone who has never seen the project can take it over.

The infrastructure is defined as code in [`infra/`](./infra) (Terraform) and the
deploy is a one-click GitHub Actions workflow
([`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml)). The
architecture rationale lives in the approved design plan; this document is the
operational how-to.

---

## 1. Architecture at a glance

```
Internet ──► CloudFront "app"  ──(VPC origin)──► internal ALB ──► Fargate task ──► RDS Postgres (private)
        └──► CloudFront "assets" ──(OAC)────────► S3 bucket (private)
```

- **Compute**: ECS Fargate, single arm64 task, in public subnets (public IP is
  used only for outbound; inbound is locked to the ALB).
- **Ingress**: CloudFront is the only public entry point. It gives a stable
  HTTPS `*.cloudfront.net` URL with no custom domain. The ALB is internal (no
  public IP) and is reached through a CloudFront VPC origin.
- **Data**: RDS Postgres (not publicly accessible) and a private S3 bucket
  served through a second CloudFront distribution via Origin Access Control.
- **Secrets/identity**: app credentials come from the ECS task role (no static
  keys). Config and secrets live in Secrets Manager and the task definition.
- **Region**: `us-west-2`. **Project prefix**: `cs-capstone` (both configurable
  in `infra/variables.tf`). All resource names below assume these defaults.

---

## 2. Prerequisites

Install locally:

- AWS CLI v2, authenticated to the target account with admin-level permissions
  (`aws sts get-caller-identity` should succeed).
- Terraform >= 1.10 (`terraform version`).
- Docker (only needed if you ever build images by hand; CI does this normally).
- `jq` (used by some commands below).

Accounts and access:

- Admin access to the GitHub repository (to set Actions variables and read
  workflow runs).
- The ability to create a GitHub OAuth app (org or personal settings).

> **Email is deferred.** This deployment does not provision SES (or any other
> email provider) yet. The app runs with `EMAIL_TRANSPORT=console`, which logs
> verification/reset links to CloudWatch instead of emailing them. Sign-up
> still works, but only someone with log access can complete it. See section
> 4.1 for how to retrieve those links, and section 9 for wiring up real email
> later.

---

## 3. One-time setup

### 3.1 Create the GitHub OAuth app

1. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Homepage URL and callback URL need the app's public URL, which you do not
   have until Terraform runs. Put a placeholder now (for example
   `https://example.com`); you will correct it in step 4.3.
3. Note the **Client ID** and generate a **Client secret**. Keep both for later.

### 3.2 Create the Terraform remote state bucket

State contains generated database and auth secrets, so it must be private.

```bash
aws s3api create-bucket \
  --bucket cs-capstone-tfstate \
  --region us-west-2 \
  --create-bucket-configuration LocationConstraint=us-west-2
aws s3api put-bucket-versioning \
  --bucket cs-capstone-tfstate \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket cs-capstone-tfstate \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
# Tag it like everything else (this bucket is created outside Terraform)
aws s3api put-bucket-tagging --bucket cs-capstone-tfstate \
  --tagging 'TagSet=[{Key=Project,Value=cs-capstone},{Key=ManagedBy,Value=manual}]'
```

Then uncomment the `backend "s3"` block in
[`infra/providers.tf`](./infra/providers.tf). It uses S3-native locking
(`use_lockfile`), so no DynamoDB table is required.

### 3.3 Provide variables

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars`:

```hcl
github_owner     = "your-org-or-user"
github_repo      = "cs-capstone"
github_client_id = "Iv1.xxxxxxxx"                # from step 3.1 (not secret)
```

### 3.4 Confirm Postgres 18 is available

The app targets Postgres 18. Verify the engine version exists in the region
before applying, and pin a minor in `infra/rds.tf` if needed:

```bash
aws rds describe-db-engine-versions --engine postgres --region us-west-2 \
  --query "DBEngineVersions[?starts_with(EngineVersion,'18')].EngineVersion"
```

### 3.5 Apply the infrastructure

```bash
terraform init
terraform plan      # review; this is your first real validation
terraform apply
```

Notes:

- The `aws_cloudfront_vpc_origin` resource takes **15 to 30+ minutes** to
  create. This is expected, not a hang. The same applies on destroy.
- The ECS service is created at `desired_count = 0` on purpose; no image exists
  yet. The first deploy (step 5) pushes an image and scales it to 1.

Record the outputs (also available later via `terraform output`):

```bash
terraform output
# app_url, assets_url, ecr_repository_url, ecs_cluster, ecs_service,
# rds_endpoint, github_deploy_role_arn
```

---

## 4. Post-apply configuration

### 4.1 Email verification links (no email provider yet)

With no email provider configured, `EMAIL_TRANSPORT=console` writes
verification and password-reset links to stderr, which CloudWatch captures.
After someone signs up, pull their link from the logs:

```bash
aws logs tail /ecs/cs-capstone --since 5m --region us-west-2 | grep -A2 "VERIFY EMAIL"
```

Send or read them the URL out of band. This is fine for bootstrapping admins
(section 6) and small-scale testing; wiring up real email delivery is covered
in section 9.

### 4.2 Set the GitHub OAuth client secret

Terraform seeds a placeholder. Replace it with the real secret from step 3.1:

```bash
aws secretsmanager put-secret-value \
  --secret-id cs-capstone/github-client-secret \
  --secret-string 'YOUR_REAL_GITHUB_OAUTH_CLIENT_SECRET' \
  --region us-west-2
```

### 4.3 Fix the GitHub OAuth app URLs

Using the `app_url` output, set the OAuth app's:

- Homepage URL: `https://<app-dist>.cloudfront.net`
- Authorization callback URL:
  `https://<app-dist>.cloudfront.net/api/auth/callback/github`

The callback path must be exact.

### 4.4 Give GitHub Actions the deploy role

In the GitHub repo → Settings → Secrets and variables → Actions → Variables, add
a repository variable:

- Name: `AWS_DEPLOY_ROLE_ARN`
- Value: the `github_deploy_role_arn` Terraform output.

This is the role the workflow assumes via OIDC. No long-lived AWS keys are
stored in GitHub.

---

## 5. First deploy

Trigger the deploy: GitHub → Actions → **Deploy** → Run workflow (on `main`).

The workflow:

1. Assumes the AWS deploy role via OIDC.
2. Reads the assets CloudFront base URL from SSM and builds the linux/arm64
   image, baking it in as `VITE_STORAGE_PUBLIC_BASE`.
3. Pushes the image to ECR, tagged with the commit SHA.
4. Registers a new task definition pointing at that image.
5. Runs database migrations as a one-off ECS task and waits for exit code 0.
6. Updates the service to the new task definition, scales to 1, and waits for
   the service to stabilize.

The first run is slower because the arm64 image is built under emulation. If
your repo has arm64 hosted runners, switch `runs-on` to `ubuntu-24.04-arm` and
remove the "Set up QEMU" step in the workflow for a much faster native build.

When it finishes, open `app_url` in a browser. You should see the app over
HTTPS.

---

## 6. Bootstrap the first admins

The app requires email verification and RDS is private, so admins are bootstrapped
in two steps. Do this for **at least two** people (the app blocks a sole admin
from demoting or banning themselves).

1. Each future admin signs up through the app UI with email and password.
   Pull their verification link from CloudWatch (step 4.1) and have them open
   it.
2. Promote each to admin by running the bundled one-off task. This reuses the
   exact network configuration of the running service so it can reach the
   private database:

```bash
CLUSTER=cs-capstone
SERVICE=cs-capstone
TASKDEF=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text --region us-west-2)
NETCFG=$(aws ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].networkConfiguration' --output json --region us-west-2)

aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$TASKDEF" \
  --network-configuration "$NETCFG" \
  --overrides '{"containerOverrides":[{"name":"app","command":["node","scripts/promote-admin.mjs"],"environment":[{"name":"ADMIN_EMAIL","value":"admin1@example.edu"}]}]}' \
  --region us-west-2
```

Repeat with the second admin's email. Check the task's CloudWatch log for
`Promoted ... to admin`.

---

## 7. Verification checklist

- `curl -I https://<app-dist>.cloudfront.net/api/healthz` returns `200`.
- Signing in with GitHub completes the OAuth round trip.
- Email/password sign-up writes a verification link to CloudWatch (step 4.1)
  and completes once that link is opened.
- Uploading a project image works and the image loads from
  `https://<assets-dist>.cloudfront.net/...`.
- Triggering an AI project review succeeds (Bedrock via the task role).
- Security: connecting to the RDS endpoint from your laptop times out (it is
  private), and the internal ALB has no public DNS to hit.

---

## 8. Routine operations

### Deploy a change

Merge to `main`, then run the **Deploy** workflow. That is the whole release
process. Migrations run automatically before the new code serves traffic.

### View logs

```bash
aws logs tail /ecs/cs-capstone --follow --region us-west-2
```

### Roll back

Re-run the **Deploy** workflow from an earlier commit, or point the service at a
previous task definition revision:

```bash
aws ecs update-service --cluster cs-capstone --service cs-capstone \
  --task-definition cs-capstone:<previous-revision> --region us-west-2
aws ecs wait services-stable --cluster cs-capstone --service cs-capstone --region us-west-2
```

List revisions with `aws ecs list-task-definitions --family-prefix cs-capstone`.

### Update a secret or config

- Secrets (DATABASE_URL, BETTER_AUTH_SECRET, GITHUB_CLIENT_SECRET): update in
  Secrets Manager, then force a new deployment so tasks pick it up:
  `aws ecs update-service --cluster cs-capstone --service cs-capstone --force-new-deployment --region us-west-2`.
- Non-secret env (model ID, email from, etc.): change the value in
  `infra/ecs.tf`, `terraform apply` to register a new task-def revision, then
  run the **Deploy** workflow (which inherits the latest task-def env).

### Run a migration manually

Migrations run during deploy. To run them out of band, use the same
`run-task` pattern as section 6 with command
`["node","scripts/migrate.mjs"]` and no extra environment.

---

## 9. Adding real email delivery

Email is deferred until an email provider is set up. The app already supports
SES as a transport (`src/lib/email/ses-sender.ts`); wiring it up is
infrastructure, not code:

1. Add back an `aws_sesv2_email_identity` resource (verified sender, ideally a
   domain rather than a single address) and an IAM statement granting the ECS
   task role `ses:SendEmail`.
2. In `infra/ecs.tf`, set `EMAIL_TRANSPORT=ses`, `EMAIL_FROM=<verified
   identity>`, and `SES_REGION`.
3. `terraform apply`, then confirm the identity verification email.
4. While SES is in the **sandbox**, it can only send to verified recipients —
   verify any test/admin addresses with
   `aws sesv2 create-email-identity --email-identity <addr> --region us-west-2`.
   Request production access from the SES console to email arbitrary users.

Until this is done, sign-up still works, but verification/reset links only
reach CloudWatch logs (section 4.1), not real inboxes.

---

## 10. Cost

Rough monthly cost at capstone scale in us-west-2:

| Item | ~$/mo |
|------|------|
| Internal ALB | 17 |
| Fargate (0.25 vCPU / 0.5 GB, 1 task) | 9 |
| RDS db.t4g.micro + 20 GB | 14 |
| CloudFront + S3 + ECR + Secrets Manager | 1 to 5 |
| **Total** | **~40 to 50** |

There is deliberately no NAT Gateway (~$32/mo avoided). The ALB is the largest
line and is required for stable, secure HTTPS on Fargate.

---

## 11. Troubleshooting

**Deploy fails at migrations with `CannotPullContainerError`.** The one-off task
must run in public subnets with a public IP and the app security group. The
workflow copies this from the live service automatically; if you run a task by
hand, reuse the service's `networkConfiguration` (see section 6).

**Login redirect mismatch / "redirect_uri" error.** The GitHub OAuth callback
URL must be exactly `https://<app-dist>.cloudfront.net/api/auth/callback/github`
and `BETTER_AUTH_URL` (task-def env) must be the same app host.

**Sign-up seems to hang with no verification email.** Expected: no email
provider is configured yet. Pull the verification link from CloudWatch
(section 4.1) instead.

**CloudFront returns 502/504.** Usually the task is unhealthy. Check the target
group health and the task logs. The ALB health check path is `/api/healthz`;
the task must be reachable on port 3000 from the ALB security group.

**Tasks never become healthy.** Confirm `DATABASE_URL` resolves (the secret
exists and the execution role can read it) and that the RDS security group
allows the app security group on 5432.

**`terraform apply` seems stuck.** The CloudFront VPC origin legitimately takes
15 to 30+ minutes. Give it time.

---

## 12. Teardown

RDS has deletion protection and takes a final snapshot, and S3 must be emptied
first. To fully destroy:

1. Empty the assets bucket (find its name with
   `aws s3 ls | grep cs-capstone-assets`):

   ```bash
   aws s3 rm "s3://cs-capstone-assets-<account-id>" --recursive
   ```

2. Disable RDS deletion protection: set `deletion_protection = false` in
   `infra/rds.tf`, then `terraform apply`.

3. Destroy everything:

   ```bash
   cd infra && terraform destroy
   ```

The CloudFront VPC origin again takes 15 to 30+ minutes to delete. RDS writes a
final snapshot named `cs-capstone-db-final` (delete it separately if you do not
want it). The Terraform state bucket (`cs-capstone-tfstate`) is not managed by
this config; delete it manually if you are done with the project.

---

## 13. Reference

**Key names (defaults):**

- Region: `us-west-2`, project prefix: `cs-capstone`
- ECS cluster/service: `cs-capstone` / `cs-capstone`
- ECR repo: `cs-capstone`
- Secrets: `cs-capstone/database-url`, `cs-capstone/better-auth-secret`,
  `cs-capstone/github-client-secret`
- SSM: `/cs-capstone/ASSETS_PUBLIC_BASE`
- Log group: `/ecs/cs-capstone`

**Runtime environment (set in the task definition, `infra/ecs.tf`):**

`NODE_ENV`, `PORT`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `S3_BUCKET`,
`S3_REGION`, `BEDROCK_REGION`, `BEDROCK_MODEL_ID`, `EMAIL_TRANSPORT=console`,
plus secrets `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_SECRET`. In
production, S3 and Bedrock use the task role (no access keys). Email is
deferred (section 9); switch `EMAIL_TRANSPORT` to `ses` and add `EMAIL_FROM`
/ `SES_REGION` once it's configured.

**File map:**

- `infra/` Terraform (one file per concern: `vpc`, `security-groups`, `rds`,
  `s3`, `ecr`, `ecs`, `cloudfront`, `iam`, `secrets`, `outputs`).
- `Dockerfile`, `.dockerignore` multi-stage arm64 image build.
- `.github/workflows/deploy.yml` manual deploy workflow.
- `scripts/migrate.mjs` production migration runner.
- `scripts/promote-admin.mjs` first-admin bootstrap.
