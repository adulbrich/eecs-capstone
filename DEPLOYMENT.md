# Deploying EECS Capstone to AWS

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
- **Ingress**: CloudFront is the only public entry point, served at
  `capstone.eecs.oregonstate.edu` (section 3.7). The ALB is internal (no public
  IP) and is reached through a CloudFront VPC origin. Uploaded assets stay on
  the second distribution's `*.cloudfront.net` name; only the app has a custom
  domain.
- **Data**: RDS Postgres (not publicly accessible) and a private S3 bucket
  served through a second CloudFront distribution via Origin Access Control.
- **Secrets/identity**: app credentials come from the ECS task role (no static
  keys). Config and secrets live in Secrets Manager and the task definition.
- **Region**: `us-west-2`. **Project prefix**: `eecs-capstone` (both configurable
  in `infra/variables.tf`). All resource names below assume these defaults.

---

## 2. Prerequisites

Install locally:

- AWS CLI v2, authenticated to the target account with admin-level permissions
  (`aws --profile aws-capstone1 sts get-caller-identity` should succeed).
- Terraform >= 1.10 (`terraform version`).
- Docker (only needed if you ever build images by hand; CI does this normally).
- `jq` (used by some commands below).

Accounts and access:

- Admin access to the GitHub repository (to set Actions variables and read
  workflow runs).
- The ability to create a GitHub OAuth app (org or personal settings).

> **Email is live.** SES is provisioned (`infra/ses.tf`), the domain identity
> verifies, the account has production access, and the app runs with
> `EMAIL_TRANSPORT=ses` from `noreply@capstone.eecs.oregonstate.edu`. Section 9
> covers the setup and the one ordering rule that matters: apply, then deploy,
> because `EMAIL_TRANSPORT=ses` without `EMAIL_FROM` fails the app's boot rather
> than only its email. In local development `EMAIL_TRANSPORT=console` still
> writes links to stderr instead of sending them.

---

## 3. One-time setup

### 3.1 Create the GitHub OAuth app

1. GitHub → Settings → Developer settings → **OAuth Apps** (not "GitHub Apps" —
   easy to mix up, and the wrong one won't work with `better-auth`'s GitHub
   provider) → New OAuth App.
2. Homepage URL and callback URL need the app's public URL, which you do not
   have until Terraform runs. Put a placeholder now (for example
   `https://example.com`); you will correct it in step 4.2.
3. Note the **Client ID** and generate a **Client secret**. Keep both for later.
   OAuth App client IDs look like `Ov23xxxxxxxxxxxxxxxx`; if it starts with
   `Iv1.` instead, you created a GitHub App by mistake.

### 3.2 Create the Terraform remote state bucket

State contains generated database and auth secrets, so it must be private.

```bash
aws --profile aws-capstone1 s3api create-bucket \
  --bucket eecs-capstone-tfstate \
  --region us-west-2 \
  --create-bucket-configuration LocationConstraint=us-west-2
aws --profile aws-capstone1 s3api put-bucket-versioning \
  --bucket eecs-capstone-tfstate \
  --versioning-configuration Status=Enabled
aws --profile aws-capstone1 s3api put-bucket-encryption --bucket eecs-capstone-tfstate \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
# Tag it like everything else (this bucket is created outside Terraform)
aws --profile aws-capstone1 s3api put-bucket-tagging --bucket eecs-capstone-tfstate \
  --tagging 'TagSet=[{Key=Project,Value=eecs-capstone},{Key=ManagedBy,Value=manual}]'
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
github_repo      = "eecs-capstone"
github_client_id = "Ov23xxxxxxxxxxxxxxxx"        # from step 3.1 (not secret)
```

### 3.4 Confirm Postgres 18 is available

The app targets Postgres 18. Verify the engine version exists in the region
before applying, and pin a minor in `infra/rds.tf` if needed:

```bash
aws --profile aws-capstone1 rds describe-db-engine-versions --engine postgres --region us-west-2 \
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

### 3.6 Embeddings (interest-based recommendations)

Project recommendations use Amazon Titan Text Embeddings V2
(`amazon.titan-embed-text-v2:0`) in the same region as `BEDROCK_REGION`.

Serverless foundation models are now automatically enabled across all AWS
commercial regions the first time you invoke them in your account, so no manual
model-access grant is required. The ECS task role already carries the
`bedrock:InvokeModel` permission it needs.

AI project review is the other Bedrock caller, and it does not share this path:
it calls the `bedrock-mantle` endpoint, which authorizes
`bedrock-mantle:CreateInference` rather than `bedrock:InvokeModel`, and which is
offered in fewer regions. Both statements are on the task role in
`infra/iam.tf`.

1. The migration creates the `vector` extension. RDS PostgreSQL 18 ships
   pgvector 0.8.1, and the master user has the privileges to create it.
   Before relying on this, confirm the instance is actually on 18 in your
   region:

   ```bash
   aws rds describe-db-engine-versions --engine postgres --engine-version 18 \
     --query 'DBEngineVersions[0].SupportedFeatureNames' --output text
   aws rds describe-db-engine-versions --engine postgres --engine-version 18 \
     --query 'DBEngineVersions[0].ValidUpgradeTarget' --output table
   ```

   `infra/rds.tf:19` pins `engine_version = "18"`. If the region does not yet
   offer 18, pgvector is still available on 15, 16, and 17, so the fallback is
   pinning a lower major rather than abandoning the feature.
2. After the first deploy, backfill vectors for projects published before this
   feature existed:

   ```bash
   npm run embeddings:backfill
   ```

   The script is idempotent and safe to re-run. It exits non-zero if any
   project failed, which points at a Bedrock or database problem worth
   investigating.
3. Re-run the backfill after changing `BEDROCK_EMBEDDING_MODEL_ID`. The stored
   hash includes the model id, so every project is treated as stale and
   re-embedded automatically.

### 3.7 Custom domain and TLS certificate

The app is served at `capstone.eecs.oregonstate.edu`. Terraform does **not**
create the certificate, because the `eecs.oregonstate.edu` zone is managed by
OSU rather than by this account. `infra/cloudfront.tf` reads the existing
certificate through `data "aws_acm_certificate"`, which can never destroy it;
re-issuing one costs a support ticket with multi-day turnaround.

What exists today, created by hand:

| Item | Value |
| --- | --- |
| Certificate | `*.eecs.oregonstate.edu`, ARN ending `f6cecdcc` |
| Region | **us-east-1** (CloudFront only accepts viewer certs from us-east-1, regardless of `var.region`) |
| Validation | DNS, `_7b5da3599a6223875e6bf5dee1000c5a.eecs.oregonstate.edu` |
| Expires | 2027-02-13 |

Two DNS records live in OSU's zone and must both stay in place:

1. `capstone.eecs.oregonstate.edu` CNAME → the app distribution's
   `*.cloudfront.net` domain (`terraform output app_distribution_domain`;
   `app_url` returns the custom domain and so cannot give you the target).
   Without the matching `aliases` entry on the distribution, CloudFront answers
   `403` for this host.
2. `_7b5da3599a6223875e6bf5dee1000c5a.eecs.oregonstate.edu` CNAME →
   `_eaf2da48d6e94e7e570d398eedce87f0.jkddzztszm.acm-validations.aws`. **This is
   permanent.** ACM re-validates against it to auto-renew around December 2026.
   Deleting it after issuance breaks the site a year later with no other warning.

To stand this up from scratch: request a DNS-validated certificate in us-east-1,
send both records to EECS IT in one ticket, and note in the ticket that record 1
returns `403` until `terraform apply` attaches the alias, so an early test
failure is expected rather than a bad request.

The cutover to this hostname is done: `BETTER_AUTH_URL`, the `app_url` output,
and the GitHub OAuth callback all point at it, and the old
`*.cloudfront.net` URL no longer accepts logins. That last part is deliberate,
not a regression. `better-auth` derives its trusted origins from
`BETTER_AUTH_URL` and reads that env var *before* it will consider
`x-forwarded-host`, so `trustHost` does not extend trust to a second hostname:
requests from any other origin fail with `INVALID_ORIGIN`. Serving two
hostnames would mean listing both in `trustedOrigins`, which this project has
no reason to do.

If you ever move the hostname again, remember that applying is only half of
it. The service carries `ignore_changes = [task_definition]`, so a changed
`BETTER_AUTH_URL` reaches the container only on the next deploy. Section 9.5
covers the same mechanism in more detail.

---

## 4. Post-apply configuration

### 4.1 Set the GitHub OAuth client secret

Terraform seeds a placeholder. Replace it with the real secret from step 3.1:

```bash
aws --profile aws-capstone1 secretsmanager put-secret-value \
  --secret-id eecs-capstone/github-client-secret \
  --secret-string 'YOUR_REAL_GITHUB_OAUTH_CLIENT_SECRET' \
  --region us-west-2
```

### 4.2 Fix the GitHub OAuth app URLs

Using the `app_url` output, set the OAuth app's:

- Homepage URL: `https://capstone.eecs.oregonstate.edu`
- Authorization callback URL:
  `https://capstone.eecs.oregonstate.edu/api/auth/callback/github`

The callback path must be exact, and it must match `BETTER_AUTH_URL`. GitHub
allows one callback URL per OAuth app, so changing the app's hostname is a hard
cutover rather than a gradual one.

### 4.3 Give GitHub Actions the deploy role

In the GitHub repo → Settings → Secrets and variables → Actions → Variables, add
a repository variable:

- Name: `AWS_DEPLOY_ROLE_ARN`
- Value: the `github_deploy_role_arn` Terraform output.

This is the role the workflow assumes via OIDC. No long-lived AWS keys are
stored in GitHub.

---

### 4.4 Set the ONID client secret

Terraform seeds a placeholder here too. Unlike the GitHub secret, this value
does not originate in AWS: UIT issue it into the Azure Key Vault
`kv-engr-coe-vault-caps` and it is copied across by hand.

```bash
aws --profile aws-capstone1 secretsmanager put-secret-value \
  --secret-id eecs-capstone/onid-client-secret \
  --secret-string 'YOUR_REAL_ONID_CLIENT_SECRET' \
  --region us-west-2
```

UIT issued two secrets on the one client ID. The production one goes here; the
development one is for localhost and stays out of AWS.

**The production secret expires 2028-08-24. Put that in a shared calendar when
you set it.** It does not auto-renew, UIT do not track expiry dates on their
side, and nothing in this stack will warn you: sign-in simply starts failing on
that date. Renewal is a request through the UIT support portal.

The redirect URI, confirmed registered by UIT, is
`https://capstone.eecs.oregonstate.edu/api/auth/oauth2/callback/onid`. Note the
`oauth2` segment, which differs from GitHub's `/api/auth/callback/github` in
section 4.2. That is the Better Auth 1.6 generic-OAuth path, Entra matches
redirect URIs exactly, and `package.json` pins `~1.6` because 1.7 moves it. See
`docs/ONID-SSO.md` before upgrading.

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

The workflow builds natively on a `ubuntu-24.04-arm` runner (free on public
repos), matching the arm64 Fargate task — no QEMU cross-build involved.

When it finishes, open `app_url` in a browser. You should see the app over
HTTPS.

---

## 6. Bootstrap the first admins

The app requires email verification and RDS is private, so admins are bootstrapped
in two steps. Do this for **at least two** people (the app blocks a sole admin
from demoting or banning themselves).

With no email provider configured yet (see the callout in section 2),
`EMAIL_TRANSPORT=console` writes verification links to stderr, which
CloudWatch captures instead of an inbox. Once the first deploy (section 5)
has run and someone has signed up, pull their link from the logs:

```bash
aws --profile aws-capstone1 logs tail /ecs/eecs-capstone --since 5m --region us-west-2 | grep -A2 "VERIFY EMAIL"
```

1. Each future admin signs up through the app UI with email and password.
   Pull their verification link from the command above and have them open it.
2. Promote each to admin by running the bundled one-off task. This reuses the
   exact network configuration of the running service so it can reach the
   private database:

```bash
CLUSTER=eecs-capstone
SERVICE=eecs-capstone
TASKDEF=$(aws --profile aws-capstone1 ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].taskDefinition' --output text --region us-west-2)
NETCFG=$(aws --profile aws-capstone1 ecs describe-services --cluster "$CLUSTER" --services "$SERVICE" \
  --query 'services[0].networkConfiguration' --output json --region us-west-2)

aws --profile aws-capstone1 ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
  --task-definition "$TASKDEF" \
  --network-configuration "$NETCFG" \
  --overrides '{"containerOverrides":[{"name":"app","command":["node","scripts/promote-admin.mjs"],"environment":[{"name":"ADMIN_EMAIL","value":"admin1@example.edu"}]}]}' \
  --region us-west-2
```

Repeat with the second admin's email. Check the task's CloudWatch log for
`Promoted ... to admin`.

---

## 7. Verification checklist

- `curl -I https://capstone.eecs.oregonstate.edu/api/healthz` returns `200`.
- Signing in with GitHub completes the OAuth round trip.
- The origin check accepts the public hostname. This POST should return
  `INVALID_EMAIL_OR_PASSWORD`, not `INVALID_ORIGIN`:

  ```bash
  curl -s -X POST https://capstone.eecs.oregonstate.edu/api/auth/sign-in/email \
    -H 'Content-Type: application/json' \
    -H 'Origin: https://capstone.eecs.oregonstate.edu' \
    -d '{"email":"probe@example.invalid","password":"x"}'
  ```
- Email/password sign-up writes a verification link to CloudWatch (section 6)
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
aws --profile aws-capstone1 logs tail /ecs/eecs-capstone --follow --region us-west-2
```

### Roll back

Re-run the **Deploy** workflow from an earlier commit, or point the service at a
previous task definition revision:

```bash
aws --profile aws-capstone1 ecs update-service --cluster eecs-capstone --service eecs-capstone \
  --task-definition eecs-capstone:<previous-revision> --region us-west-2
aws --profile aws-capstone1 ecs wait services-stable --cluster eecs-capstone --service eecs-capstone --region us-west-2
```

List revisions with
`aws --profile aws-capstone1 ecs list-task-definitions --family-prefix eecs-capstone`.

### Update a secret or config

- Secrets (DATABASE_URL, BETTER_AUTH_SECRET, GITHUB_CLIENT_SECRET,
  ONID_CLIENT_SECRET): update in
  Secrets Manager, then force a new deployment so tasks pick it up:
  `aws --profile aws-capstone1 ecs update-service --cluster eecs-capstone --service eecs-capstone --force-new-deployment --region us-west-2`.
- Non-secret env (model ID, email from, etc.): change the value in
  `infra/ecs.tf`, `terraform apply` to register a new task-def revision, then
  run the **Deploy** workflow (which inherits the latest task-def env).

### Run a migration manually

Migrations run during deploy. To run them out of band, use the same
`run-task` pattern as section 6 with command
`["node","scripts/migrate.mjs"]` and no extra environment.

### Find and clear image URLs the app did not mint

`image_url` on `projects` and `inventory_items` is guarded on the change, not
on what a row already holds, see
"What `image_url` may contain, and why the check is on the change"
in `docs/QUIRKS.md`, so
a row written before the upload flow, or before #162, can still carry an
absolute URL and still render it. Nothing in the column tells a stock photo
somebody chose from a planted link, so `scripts/image-url-legacy.mjs` does not
decide: it reports, and a person does.

Run it exactly like the `promote-admin` task in section 6, with
`["node","scripts/image-url-legacy.mjs"]` and no environment. **That run
writes nothing.** It prints one line per row, table, id and the full value,
and the task's CloudWatch log is the report. An empty report closes #165.

To clear the rows that should go, run again with:

```json
"environment":[{"name":"CONFIRM","value":"NULL"},{"name":"TARGET_IDS","value":"<id>,<id>"}]
```

It nulls exactly those ids and prints each one. An id that is not in the
report, whether it names a healthy row or nothing, is refused and left alone,
and the task exits non-zero to say so. There is no flag that nulls everything.
The null is an operator write: it sets `updated_at` and leaves no
`project_edit_log` or `inventory_item_edit_log` row, since there is no editor
to attribute one to.

---

## 9. Adding real email delivery

The app sends from `noreply@capstone.eecs.oregonstate.edu` via SES
(`src/lib/email/ses-sender.ts`), with replies going to
`eecs-capstone@oregonstate.edu`. Everything in AWS is ready: the code is done,
the three DKIM records below are published and the domain verifies, and
production access is granted (9.4). `infra/ecs.tf` selects `EMAIL_TRANSPORT=ses`.

What remains is entirely a deployment step (9.5), and it is the part most likely
to be got wrong: Terraform changes do not reach the running service on their own,
so a successful `terraform apply` is not evidence that email works. Confirm with
a real sign-up.

`infra/ses.tf` and the `SendEmail` statement in `infra/iam.tf` are already in
place, as are `EMAIL_FROM`, `EMAIL_REPLY_TO` and `SES_REGION` in `infra/ecs.tf`.

Sections 9.1 through 9.3 record how the identity was set up; they are kept
because the records are permanent and someone will eventually have to explain
or re-create them.

**A domain identity, not an address identity.** SES verifies an address
identity by emailing it a confirmation link that a human must click, and
`noreply@` has no mailbox. Domain identity is the only workable option here.

### 9.1 Why DKIM is mandatory

`oregonstate.edu` publishes `v=DMARC1; p=reject` with no `sp=` override. Under
RFC 7489 policy discovery a receiver looks up `_dmarc.<the exact domain>`,
finds nothing, and then jumps straight to the organizational domain
`_dmarc.oregonstate.edu`, skipping intermediate labels. The `p=none` on
`eecs.oregonstate.edu` therefore does **not** apply to
`capstone.eecs.oregonstate.edu`. (Newer tree-walk discovery would find it, so
behavior varies by receiver; assume the strict reading.)

Unaligned mail is rejected outright, not spam-foldered. DKIM alignment is the
whole game, which is why `EMAIL_FROM` derives from `var.domain_name`: the
`From:` domain must match the DKIM `d=` domain.

SPF alignment is not required. DMARC passes on either SPF *or* DKIM, and
without a custom MAIL FROM domain SES uses an `amazonses.com` envelope sender,
which never aligns. A custom MAIL FROM domain adds robustness through
forwarding but needs `MX` and `TXT` records, so treat it as a later
improvement rather than part of this setup.

### 9.2 Get the DKIM records

```bash
cd infra
terraform apply          # creates the identity; generates the DKIM tokens
terraform output ses_dkim_records
```

This yields three CNAMEs of the form
`<token>._domainkey.capstone.eecs.oregonstate.edu` →
`<token>.dkim.amazonses.com`.

### 9.3 The OSU ticket

Send EECS IT all three records. Two things to state explicitly:

- **They are permanent.** SES re-checks them and will mark the domain
  unverified if they disappear, silently killing sign-up.
- **They sit below a name that is itself a CNAME** to CloudFront. A CNAME may
  not share its own label with other records, but records at *descendant*
  names are a grey area that some DNS implementations refuse. Ask whether
  their tooling accepts it.

If it does not, verify a sibling name instead, for example
`mail.eecs.oregonstate.edu`, and send from `noreply@mail.eecs.oregonstate.edu`.
No CNAME sits at that label, so DKIM records land cleanly. Set `var.domain_name`
aside and give `infra/ses.tf` its own variable in that case, since the sending
domain and the site domain would no longer be the same string.

Check progress without waiting on a ticket reply:

```bash
aws --profile aws-capstone1 sesv2 get-email-identity \
  --email-identity capstone.eecs.oregonstate.edu --region us-west-2 \
  --query '{Verified:VerifiedForSendingStatus,Dkim:DkimAttributes.Status}'
```

### 9.4 Leave the sandbox

A new account is capped at 200 messages/day, 1/second, **and can only send to
verified addresses**. Check with:

```bash
aws --profile aws-capstone1 sesv2 get-account --region us-west-2 \
  --query 'ProductionAccessEnabled'
```

`false` means sandbox. **This is now `true`: production access was granted, and
the quota rose from 200/day at 1/sec to 50,000/day at 14/sec.** The section is
kept because the sandbox is easy to overlook (nothing about the domain looks
wrong while it applies) and because a new account in a rebuilt environment
starts there again.

Sandbox imposes three limits, and the third is the one that matters:

| Limit | Sandbox | Effect here |
|---|---|---|
| Daily volume | 200 / day | Tolerable at capstone scale |
| Send rate | 1 / second | Tolerable; sends are one-at-a-time |
| **Recipients** | **Verified identities only** | **Every real student's verification email is rejected** |

Request production access from the SES console (Account dashboard → Request
production access). It goes to AWS Support with roughly a day's turnaround and
is independent of the DNS work, so file it early. Expect to describe the
sending use case, volume, and how bounces are handled. For this app the honest
answers are: transactional only (email verification and password reset, no
marketing), recipients are self-selected users who typed their own address into
a sign-up form, a few hundred messages per term with bursts at term start, and
bounces handled by the account-level suppression list, which is adequate at this
volume. There are no configuration sets, so there is no SNS bounce plumbing to
describe; do not claim otherwise.

To test before it clears, verify individual recipients:

```bash
aws --profile aws-capstone1 sesv2 create-email-identity \
  --email-identity you@example.com --region us-west-2
```

### 9.5 Cut over

**This is done.** Both preconditions were met (`VerifiedForSendingStatus` is
`true`, production access granted), `infra/ecs.tf` selects `"ses"`, and the
apply and deploy have run: task definition revision 22 carries
`EMAIL_TRANSPORT=ses`, `EMAIL_FROM=noreply@capstone.eecs.oregonstate.edu`,
`EMAIL_REPLY_TO=eecs-capstone@oregonstate.edu` and `SES_REGION=us-west-2`, and
the service is running it. What follows is why the order matters, for whoever
changes these variables next.

**Apply before deploying, not after.** This is not only a question of when a new
value takes effect. `getEmailSender()` runs at module scope in
`src/lib/auth.ts`, and `createSesEmailSender` throws when `EMAIL_FROM` is unset,
so a container that received `EMAIL_TRANSPORT=ses` without it would fail to boot
at all rather than merely fail to send. `terraform apply` writes all four
variables into a single revision, so they can only arrive together. Never
hand-edit the transport in the ECS console, which is the one path that can
separate them.

**Check the right task definition family.** It is `eecs-capstone`
(`var.project`), and a stale `cs-capstone` family also exists in the account,
frozen at revision 4 with an old `EMAIL_TRANSPORT=console`. Querying that one by
mistake reports the cutover as not applied when it is:

```bash
aws --profile aws-capstone1 --region us-west-2 ecs describe-task-definition \
  --task-definition eecs-capstone \
  --query "taskDefinition.{rev:revision,env:containerDefinitions[0].environment[?starts_with(name,'EMAIL')]}"
```

**Applying is not enough.** `aws_ecs_service.app` carries
`ignore_changes = [task_definition, desired_count]`, so `terraform apply`
registers a new task definition revision and deliberately leaves the service
on the old one. Environment variables reach the running container only when
the deploy workflow next runs: it reads the latest ACTIVE revision, swaps in
the freshly built image, and updates the service. So the cutover is apply
**then** deploy. This is why `terraform apply` reporting success is not
evidence that email is on; confirm with a real sign-up instead.

Until then sign-up still works, but verification and reset links reach only
CloudWatch logs (section 6), not real inboxes.

### 9.6 Reply-To

`noreply@capstone.eecs.oregonstate.edu` has no mailbox, so a reply to a
verification or reset email disappears. `EMAIL_REPLY_TO` names an address that
does receive mail, and the app puts it in `ReplyToAddresses` on every message
it sends.

The address is decided: `eecs-capstone@oregonstate.edu`, carried as the default
of `var.email_reply_to` in `infra/variables.tf` rather than in
`terraform.tfvars`, which is gitignored and so would not reach anyone else's
checkout. Override per-apply if needed:

```bash
cd infra
terraform apply -var 'email_reply_to=someone-else@oregonstate.edu'
```

It remains optional at every layer, which matters only as a failure mode: the
task definition always passes the variable, `buildEmailSenderConfig`
(`src/lib/email/config.ts`) treats blank as unset, and `SesEmailSender` omits
the header rather than sending an empty list. Only `EMAIL_FROM` is required
under `EMAIL_TRANSPORT=ses`, and that throw is still in `createSesEmailSender`,
so a blank Reply-To degrades rather than breaks.

**This address must be a real, monitored mailbox or distribution list.**
`oregonstate.edu` MX points at Exchange Online, so it is a tenant-side object
that someone has to create and watch. Nothing in AWS validates it: SES does not
verify Reply-To, and a nonexistent address fails invisibly, since the mail still
sends and only the human's reply vanishes.

Unlike `EMAIL_FROM`, this address plays no part in DMARC: alignment is checked
against the `From:` domain and the DKIM `d=` domain, and `Reply-To` is not an
authenticated header. So it needs no SES verification and need not live on
`capstone.eecs.oregonstate.edu` at all. An ordinary OSU mailbox or a shared
alias is fine, and is the point: replies should reach a person.

### 9.7 Review inbox

`EMAIL_REVIEW_INBOX` receives the notice when a proposer submits a project. It
holds the same address as `EMAIL_REPLY_TO` today but means something different:
one is where replies land, the other is who reviews submissions. Keeping them
separate means changing either does not silently change the other.

It is a destination rather than a sender, so it needs no SES identity and no
DKIM alignment. Unset, submissions email nobody and the app logs it; nothing
else degrades.

### 9.8 SES console wizard

The console's getting-started wizard maps onto the above loosely. Step 1 asks
for an email address, which is a **sandbox test recipient**, not your sender.
Step 2 is the domain identity that actually matters. Step 3's pricing plan is
Virtual Deliverability Manager, which is paid and unnecessary at this scale.
Steps 4 through 6 (deliverability enhancements, dedicated IP pools, tenant
management) are for high-volume senders and should be skipped.

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
URL must be exactly
`https://capstone.eecs.oregonstate.edu/api/auth/callback/github` and
`BETTER_AUTH_URL` (task-def env) must be the same app host.

**Login fails with `INVALID_ORIGIN`.** `BETTER_AUTH_URL` on the *running* task
definition disagrees with the hostname in the browser. Editing `infra/ecs.tf`
and applying is not enough; the service ignores task-definition changes, so
check what is actually deployed:

```bash
TD=$(aws --profile aws-capstone1 ecs describe-services --cluster eecs-capstone \
  --services eecs-capstone --region us-west-2 \
  --query 'services[0].taskDefinition' --output text)
aws --profile aws-capstone1 ecs describe-task-definition --task-definition "$TD" \
  --region us-west-2 \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`BETTER_AUTH_URL`]'
```

If it shows the old host, run the deploy workflow.

**Sign-up seems to hang with no verification email.** Expected: no email
provider is configured yet. Pull the verification link from CloudWatch
(section 6) instead.

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
   `aws --profile aws-capstone1 s3 ls | grep eecs-capstone-assets`):

   ```bash
   aws --profile aws-capstone1 s3 rm "s3://eecs-capstone-assets-<account-id>" --recursive
   ```

2. Disable RDS deletion protection: set `deletion_protection = false` in
   `infra/rds.tf`, then `terraform apply`.

3. Destroy everything:

   ```bash
   cd infra && terraform destroy
   ```

The CloudFront VPC origin again takes 15 to 30+ minutes to delete. RDS writes a
final snapshot named `eecs-capstone-db-final` (delete it separately if you do not
want it). The Terraform state bucket (`eecs-capstone-tfstate`) is not managed by
this config; delete it manually if you are done with the project.

---

## 13. Reference

**Key names (defaults):**

- Region: `us-west-2`, project prefix: `eecs-capstone`
- ECS cluster/service: `eecs-capstone` / `eecs-capstone`
- ECR repo: `eecs-capstone`
- Secrets: `eecs-capstone/database-url`, `eecs-capstone/better-auth-secret`,
  `eecs-capstone/github-client-secret`, `eecs-capstone/onid-client-secret`
- SSM: `/eecs-capstone/ASSETS_PUBLIC_BASE`
- Log group: `/ecs/eecs-capstone`

**Runtime environment (set in the task definition, `infra/ecs.tf`):**

`NODE_ENV`, `PORT`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `ONID_CLIENT_ID`,
`ONID_DISCOVERY_URL`, `S3_BUCKET`, `S3_REGION`, `BEDROCK_REGION`,
`BEDROCK_MODEL_ID`, `BEDROCK_REASONING_EFFORT`, `BEDROCK_EMBEDDING_MODEL_ID`,
`BEDROCK_EMBEDDING_DIMENSIONS`, `AI_REVIEW_LIMIT_PER_HOUR`,
`AI_REVIEW_LIMIT_PER_DAY`, `EMAIL_TRANSPORT=ses`, `EMAIL_FROM`,
`EMAIL_REPLY_TO`, `EMAIL_REVIEW_INBOX`, `SES_REGION`, plus secrets
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_SECRET`,
`ONID_CLIENT_SECRET`. In production, S3 and Bedrock use the task role, so no
access keys and no `S3_ENDPOINT` are set; `BEDROCK_EMBEDDINGS_ENABLED` is
deliberately not plumbed either.

This list is written by hand and `infra/ecs.tf` is the source of truth. The
test in `src/lib/__tests__/env-contract.test.ts` checks the task definition
against what the code reads, which is the part that can be automated; prose
cannot be, so read it as a summary and not as the contract.

**File map:**

- `infra/` Terraform (one file per concern: `vpc`, `security-groups`, `rds`,
  `s3`, `ecr`, `ecs`, `cloudfront`, `iam`, `secrets`, `outputs`).
- `Dockerfile`, `.dockerignore` multi-stage arm64 image build.
- `.github/workflows/deploy.yml` manual deploy workflow.
- `scripts/migrate.mjs` production migration runner.
- `scripts/promote-admin.mjs` first-admin bootstrap.
- `scripts/image-url-legacy.mjs` report of `image_url` values the app did not
  mint, with a null-by-id mode.
