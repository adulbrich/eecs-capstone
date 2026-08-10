# Preview deployment

A second running copy of the app on AWS, fed from any branch, seeded with the
dev data, banner-marked as preview, and safe to send email from. Phase 1 is one
shared preview environment dispatched at a branch. Phase 2, outlined but not
specced to implementation depth, turns that into one preview per pull request.

## Goal

1. Deploy any branch to a running AWS environment that uses the same stack as
   production: same image, same Fargate, same RDS Postgres, same SES.
2. Reset that environment's database and reseed it with `scripts/seed-dev.ts`
   on every deploy, so the data is known and disposable.
3. Mark every page with a banner that cannot be missed, so nobody mistakes the
   preview for production.
4. Let email actually send, labelled in the subject, without mailing a real
   person and without damaging the shared AWS account's SES reputation.
5. Cost as little as possible while sharing production's network, and be
   stoppable to near zero when idle.

## Context

### What exists today

`.github/workflows/deploy.yml` is a manual `workflow_dispatch` that builds an
arm64 image tagged with the commit SHA, pushes it to ECR, registers a new task
definition, runs `node scripts/migrate.mjs` as a one-off Fargate task, and rolls
the ECS service. `infra/` is a single Terraform configuration with no workspaces
and no environment variable driving resource names; `var.project` is
`eecs-capstone` and every resource interpolates it.

Production is one internal ALB behind a CloudFront VPC origin, one Fargate task,
one RDS instance, and a second CloudFront distribution serving a private S3
bucket through Origin Access Control.

### Four constraints found in the existing code

These decided most of the design and each one is load-bearing.

**The OIDC trust blocks branch deploys outright.** `infra/iam.tf:116-123` scopes
the deploy role's `sub` claim to `ref:refs/heads/${var.deploy_branch}`. A
workflow dispatched from a feature branch cannot assume that role, or any other
role in the account. Preview is therefore an IAM change before it is a workflow
change. The comment at `infra/iam.tf:105-107` already names the fix.

**The runtime image cannot run the dev seeds.** `Dockerfile:31-38` installs with
`npm ci --omit=dev` and copies only `.output`, `drizzle/`, and two `.mjs`
scripts. `scripts/seed-dev.ts` is TypeScript, needs `tsx`, and imports
`#/lib/auth` because Better Auth owns the password hashing that writes the
`account` rows. None of that is in the image.

**Dropping only the `public` schema silently corrupts the database.** Drizzle's
Postgres migrator keeps its ledger at `drizzle.__drizzle_migrations`, in a
separate schema, not in `public`
(`node_modules/drizzle-orm/pg-core/dialect.js:45-46`). A reset that drops
`public` alone leaves a ledger claiming every migration is applied, so
`scripts/migrate.mjs` no-ops and the app starts against an empty database.

**Seeded addresses reach real people.** `scripts/seed-dev.ts` seeds
`grace.kim@oregonstate.edu`, `miguel.alvarez@oregonstate.edu`,
`leej@oregonstate.edu`, and `riveras@oregonstate.edu`, plus three addresses on
`acmerobotics.com`, `northstar.io`, and `vitalink.health`, which are registrable
domains someone may own. SES has left the sandbox
(`infra/ecs.tf:98-102`), and `var.email_review_inbox` defaults to the live
`eecs-capstone@oregonstate.edu` staff inbox. A subject label does not stop any
of that.

### Why host-header routing cannot work here

`infra/cloudfront.tf:88-93` gives the `/assets/*` cache behavior no origin
request policy on purpose, as a cost optimization. CloudFront therefore rewrites
`Host` to the origin's own domain on those requests. Any ALB listener rule keyed
on `Host` would route the app's HTML to one environment and its hashed assets to
whichever environment owns the default action.

## Decisions

| Question | Decision |
|---|---|
| Isolation | Separate RDS instance, shared VPC and ALB. Not a separate stack. |
| RDS size | `db.t4g.micro`, the smallest class RDS Postgres offers, with every surrounding knob at its minimum. |
| Hostname | The preview CloudFront distribution's own `*.cloudfront.net` name. No ACM certificate, no OSU DNS ticket. |
| Email safety | Rewrite every seeded address to `example.com`, and map `example.com` recipients to the SES mailbox simulator so nothing bounces. |
| GitHub OAuth | A second GitHub OAuth app registered against the preview hostname. |
| Per-PR previews | Phase 2. Specced to decision depth here, gated on one AWS behaviour that has to be verified first. |

## Architecture

```
                      ┌─ preview CloudFront ──[X-Preview-Origin: <secret>]──┐
Internet ─────────────┤                                                      │
                      └─ prod CloudFront ─────────(no header)────────────────┤
                                                                             │
                                        (shared VPC origin, shared ALB :80) ─┤
                                                                             │
                          ┌──────────────────────────────────────────────────┘
                          │
                    ALB listener :80
                          ├─ rule: header matches ──► preview target group ──► preview Fargate task ──► preview RDS
                          └─ default ───────────────► prod target group ─────► prod Fargate task ────► prod RDS
```

Shared with production: VPC, subnets, the internal ALB, its port 80 listener,
the CloudFront VPC origin, the SES domain identity, and the GitHub OIDC
provider.

New under the prefix `eecs-capstone-preview`: RDS instance, ECS cluster, ECS
service and task definition, ECR repository, S3 assets bucket, assets CloudFront
distribution, app CloudFront distribution, ALB target group and listener rule,
three security groups' worth of rules, three secrets, two SSM parameters, and
three IAM roles.

### Routing by origin custom header

`custom_header` sits on the CloudFront `origin` block, not on a cache behavior,
so it is sent on every origin request regardless of which behavior matched. That
is exactly the property `Host` lacks here, and it is why this and not host-based
routing.

A single ALB listener rule matches that header and forwards to the preview
target group, and the existing unconditional default action keeps serving
production. The header value is generated by `random_password` and lives in
Terraform state, so it doubles as origin authentication: the ALB is internal,
but a workload inside the VPC cannot reach the preview environment without it.

**Both distributions must set the header, not just preview.** Production's
default behavior uses `Managed-AllViewer` (`infra/cloudfront.tf:79`), which
forwards every viewer header to the origin. If production sent no
`X-Preview-Origin` of its own, a viewer who learned the secret could send it to
production's URL and be routed to the preview target group. So production's
origin gets `X-Preview-Origin` set to a second, different `random_password`
value, which overrides whatever the viewer sent. This is a change to
`infra/cloudfront.tf`, not only an addition in `infra/preview.tf`.

Two AWS behaviours have to be confirmed before the rest of `infra/preview.tf` is
written. Both are answered by a single `terraform plan` and first apply.

1. **Does the provider accept `custom_header` alongside `vpc_origin_config` in
   one `origin` block?** The attribute belongs to `origin` and should be
   independent of origin type, but VPC origins are new enough not to assume it.
2. **Does an origin custom header override a same-named viewer header** when the
   origin request policy forwards all viewer headers? AWS documents origin
   custom headers as taking precedence. If the viewer's value wins instead, the
   override above does not close the hole and the fallback is required.

The fallback for either failure is a second ALB listener on port 8080, a second
`aws_cloudfront_vpc_origin` against the same ALB at that port, and matching
ingress rules for port 8080 on the ALB security group from both the VPC CIDR and
`CloudFront-VPCOrigins-Service-SG` (mirroring `infra/security-groups.tf:30-58`).
It costs 15 to 30 minutes per create and per destroy, per
`infra/cloudfront.tf:2`, which is tolerable once for a single preview and is not
tolerable per pull request.

### Phase 1 answers phase 2's gating question for free

The preview distribution references the existing
`aws_cloudfront_vpc_origin.alb` rather than creating its own. That means phase 1
is itself two CloudFront distributions sharing one VPC origin, which is exactly
the behaviour phase 2 needs N times over. If phase 1 applies cleanly on the
shared origin, phase 2's central unknown is already resolved. If phase 1 has to
fall back to a VPC origin of its own, that is the signal phase 2 is not worth
building.

### Why a separate ECS cluster

An ECS cluster costs nothing. A separate one turns the preview deploy role's
`ecs:cluster` condition from a workaround into an actual boundary, so the
preview role cannot run tasks in production's cluster even if a task definition
family name were ever confused.

## Components

### `infra/preview.tf` (new)

One file, so the preview stack can be read and reasoned about in one place.

**RDS.** `aws_db_instance.preview`, identifier `eecs-capstone-preview-db`,
`db.t4g.micro`, engine `postgres` 18, `db_name = "eecs_capstone_preview"`, 20 GB
`gp3` with no `max_allocated_storage`, `backup_retention_period = 0`,
`deletion_protection = false`, `skip_final_snapshot = true`, `multi_az = false`,
`publicly_accessible = false`. Reuses `aws_db_subnet_group.main`. Its own
security group, so a production task cannot open a connection to it.

**ECS.** `aws_ecs_cluster.preview`, `aws_ecs_task_definition.preview` (family
`eecs-capstone-preview`, arm64, 256 CPU / 512 MB to match production), and
`aws_ecs_service.preview` with `desired_count = 0` and
`lifecycle { ignore_changes = [task_definition, desired_count] }`, matching the
production pattern at `infra/ecs.tf:169-172`.

**Load balancing.** `aws_lb_target_group.preview` on `var.app_port` with the
same `/api/healthz` check, plus `aws_lb_listener_rule.preview` on the existing
port 80 listener with an `http_header` condition on `X-Preview-Origin`.

**CloudFront.** `aws_cloudfront_distribution.preview` with no `aliases`, so it
serves on its own `*.cloudfront.net` name with the default certificate. Same
behavior shape as production: `Managed-CachingDisabled` plus `Managed-AllViewer`
on the default behavior, `Managed-CachingOptimized` on `/assets/*`. It references
the existing `aws_cloudfront_vpc_origin.alb`. It attaches an
`aws_cloudfront_response_headers_policy` adding
`X-Robots-Tag: noindex, nofollow`.

**Assets.** `aws_s3_bucket.preview_assets` with the same public access block,
encryption, and OAC-only bucket policy as production, plus a lifecycle rule
expiring objects after 7 days, because every reset orphans the previous run's
uploads. A second `aws_cloudfront_distribution.preview_assets` in front of it.

**Secrets and parameters.** `eecs-capstone-preview/database-url`,
`eecs-capstone-preview/better-auth-secret`, and
`eecs-capstone-preview/github-client-secret` (placeholder with
`ignore_changes`, as production does). The database URL must carry the same
`?sslmode=verify-full&sslrootcert=/etc/ssl/certs/rds-global-bundle.pem` suffix
production uses (`infra/secrets.tf:11-15`); Postgres 18's default parameter
group enforces `rds.force_ssl`, and a bare connection string fails in a way that
reads as a network problem. SSM
`/eecs-capstone-preview/ASSETS_PUBLIC_BASE` and
`/eecs-capstone-preview/APP_URL`, both read by the workflow.

**IAM.** Execution and task roles mirroring production's, with the task role's
S3 statement scoped to the preview bucket and its `ses:SendEmail` statement
still pointing at the one shared identity. Deploy role covered below.

`aws_cloudfront_distribution.preview.domain_name` is known within the same
apply, so `BETTER_AUTH_URL` needs no second phase.

### `infra/security-groups.tf` (modified)

Add `aws_security_group.preview_app` and `aws_security_group.preview_rds` with
the same shape as the production pair: app port ingress from the ALB security
group only, all egress, and Postgres ingress on the RDS group from the preview
app group only. Add an ALB egress rule to the preview app group.

No new ALB ingress is needed under the custom-header design, because preview
traffic arrives on the existing port 80 listener.

### `infra/cloudfront.tf` (modified)

Add a `custom_header` block to the production distribution's `alb` origin
setting `X-Preview-Origin` to its own `random_password` value, so a viewer
cannot supply the preview value and be routed to the preview target group. This
is the only change to production's serving path, and it is additive.

### Preview task definition environment

Same as production except for these. `EMAIL_TRANSPORT` stays `ses` and
`EMAIL_FROM` stays `noreply@capstone.eecs.oregonstate.edu`, because the SES
identity is shared and DKIM aligns on the sending domain, not the app's
hostname.

| Variable | Value | Why |
|---|---|---|
| `BETTER_AUTH_URL` | the preview distribution's `https://d***.cloudfront.net` | Better Auth reads it before `x-forwarded-host`, so a mismatch fails every request with `INVALID_ORIGIN` (`infra/ecs.tf:86-90`). |
| `EMAIL_SUBJECT_PREFIX` | `[PREVIEW]` | The label the README asks for. |
| `EMAIL_SIMULATOR_DOMAINS` | `example.com` | Recipients in these domains are rewritten to the SES mailbox simulator. |
| `EMAIL_REVIEW_INBOX` | `review@example.com` | Must not be the live staff inbox. It is subject to the simulator rewrite like any other recipient; config is not exempt. |
| `EMAIL_REPLY_TO` | empty | No human should reply to preview mail. |
| `GITHUB_CLIENT_ID` | the preview OAuth app's id | A GitHub OAuth app accepts one callback URL, so production's cannot serve the preview hostname. |

Build arg, not environment: `VITE_PREVIEW_BANNER=1`, alongside the preview
`VITE_STORAGE_PUBLIC_BASE`.

### `src/lib/email/sender.ts` (modified)

`getEmailSender()` wraps whichever transport it built in a decorator when either
`EMAIL_SUBJECT_PREFIX` or `EMAIL_SIMULATOR_DOMAINS` is set. One seam, so there is
one place to reason about preview mail.

The decorator does two things:

1. Prepends the prefix to `email.subject`.
2. If the recipient's domain is listed in `EMAIL_SIMULATOR_DOMAINS`, rewrites
   the address to `success+<localpart>@simulator.amazonses.com` and logs both
   the original and the rewrite.

The simulator matters more than it looks. `example.com` publishes no MX record,
so SES hard-bounces every message sent to it, and hard bounces count against the
whole AWS account's bounce rate. Above five percent triggers review and above ten
percent triggers a sending pause, which would stop production mail too. AWS
excludes the mailbox simulator from bounce and complaint metrics, so seeded
traffic costs the account nothing while still exercising SES, DKIM, and the real
templates.

Unchanged in production, where neither variable is set.

### `scripts/seed-dev.ts` (modified)

Every address moves to `example.com`. Ten today: three are already there, four
are `@oregonstate.edu`, and three sit on registrable company domains. Local dev
benefits from the same change.

No other change is needed. The seed calls `auth.api.signUpEmail` and then sets
`emailVerified: true` directly (`scripts/seed-dev.ts:114-117` and `133-136`),
so seeded accounts can sign in under `requireEmailVerification: true`
(`src/lib/auth.ts:39`).

Worth stating because it sizes the blast radius: `sendOnSignUp: true`
(`src/lib/auth.ts:44`) means the seed emits one verification email per seeded
user, so every preview deploy sends ten. They all land on the simulator under
this design. If that mapping ever regresses, the seed is the amplifier that
turns one mistake into ten hard bounces against the shared account.

### `scripts/reset-preview-db.mjs` (new)

Plain `pg`, no imports under `src/`, copied into the image next to
`migrate.mjs`. The no-`src/` rule is a requirement, not an accident:
`src/db/index.ts` throws at module scope without `DATABASE_URL`, and a pool held
open across a schema drop produces confusing downstream failures.

```
1. Parse DATABASE_URL. Refuse unless the database name is exactly
   `eecs_capstone_preview`. Exit non-zero with the name it saw.
2. BEGIN
     DROP SCHEMA IF EXISTS drizzle CASCADE;
     DROP SCHEMA public CASCADE;
     CREATE SCHEMA public;
   COMMIT
3. Report the drop and exit 0.
```

Both drops and the recreate go in one transaction. Split across statements, a
transient failure after `public` is dropped and recreated but before `drizzle`
is dropped leaves a ledger claiming every migration is applied against an empty
schema, which is the exact corruption this script exists to prevent, reachable
by accident instead of by design.

The `vector` extension lives in `public` and dies with it.
`drizzle/0006_living_spectrum.sql:1` recreates it with
`CREATE EXTENSION IF NOT EXISTS`, so the migrate step restores it. The
connecting user owns the recreated `public` schema, and the app connects as the
same user, so no additional grants are needed.

### `scripts/build-ops.mjs` (new) and `package.json` (modified)

`npm run build` becomes `vite build && node scripts/build-ops.mjs`. The new step
bundles `scripts/seed-dev.ts` with esbuild to `dist-ops/seed-dev.mjs`:
`--bundle --platform=node --format=esm --packages=external`.

Verified by probe: the bundle is 61 KB and its only bare imports are
`better-auth`, `better-auth/adapters/drizzle`, `better-auth/plugins`,
`better-auth/tanstack-start`, `drizzle-orm`, `drizzle-orm/node-postgres`,
`drizzle-orm/pg-core`, and `@aws-sdk/client-sesv2`. All are in `dependencies`,
so `npm ci --omit=dev` leaves them present.

`--packages=external` marks every bare import external, including one that would
resolve only through a devDependency, so the bundle succeeding does not prove
the runtime image can load it. `build-ops.mjs` therefore asserts each external
against the `dependencies` block in `package.json` and fails the build on a
miss. Putting the step in `build` rather than in the Dockerfile means CI catches
a broken seed bundle, instead of a preview deploy discovering it.

Add `dist-ops/` to `.gitignore`.

### `Dockerfile` (modified)

Copy `scripts/reset-preview-db.mjs` alongside the two existing ops scripts, and
`COPY --from=build /app/dist-ops ./dist-ops`. Both ship in the production image
too. The reset script refuses any database but the preview one, and the seed
bundle is inert unless invoked.

### `src/components/preview-banner.tsx` (new)

Full width, non-dismissible, rendered above `SiteHeader` in
`src/routes/__root.tsx`. Reads the flag from `import.meta.env.VITE_PREVIEW_BANNER`,
matching how `src/lib/storage.ts:11-16` reads its own build-time value.

New `--preview-bg` and `--preview-fg` tokens in `src/styles.css`, in both the
`:root` block and the dark block, because `docs/UI-CONVENTIONS.md` forbids hex in
components. Deliberately not Beaver Orange and not the `--status-warning`
family: both read as brand rather than as warning, and the banner's whole job is
to look like it does not belong.

`__root.tsx` also adds `<meta name="robots" content="noindex, nofollow">` to
`head()` under the same flag. The static `public/robots.txt` is baked into the
image and currently says `Disallow:` with an empty value, so it cannot carry a
per-environment rule; the CloudFront response headers policy covers everything
the meta tag does not.

The build arg is the right mechanism rather than runtime config because preview
already builds a distinct image (its `VITE_STORAGE_PUBLIC_BASE` differs), and
because the banner renders inside `shellComponent`, which receives no loader
data.

### IAM: the preview deploy role

`aws_iam_role.preview_github_deploy`, trusted on
`repo:<owner>/<repo>:environment:preview` instead of a branch ref, which is the
swap anticipated at `infra/iam.tf:105-107`. The `StringLike` renamed-repo
variant from `infra/iam.tf:121` is kept.

This is a requirement rather than an implementation detail: **an
environment-scoped subject drops the ref from the OIDC claim entirely**, so any
branch in the repo can assume the role. The GitHub Environment's required
reviewers become the only gate, and the role can `iam:PassRole`. The `preview`
Environment must exist with required reviewers before this role is applied.

Permissions, all narrower than production's:

- ECR push and pull on the preview repository only.
- `ecs:RegisterTaskDefinition`, `ecs:UpdateService`, `ecs:DescribeServices`,
  `ecs:RunTask`, `ecs:DescribeTasks`, scoped to the preview task-definition
  family with an `ArnEquals` condition on `ecs:cluster` naming the preview
  cluster.
- `iam:PassRole` on the two preview roles only.
- `ssm:GetParameter` on `/eecs-capstone-preview/*` only.
- `rds:StartDBInstance`, `rds:StopDBInstance`, `rds:DescribeDBInstances` on the
  preview instance only.

### `.github/workflows/deploy-preview.yml` (new)

```yaml
on:
  workflow_dispatch:
    inputs:
      reset_db: { type: boolean, default: true }
      stop:     { type: boolean, default: false }

concurrency:
  group: deploy-preview
  cancel-in-progress: false

permissions:
  id-token: write
  contents: read
```

The concurrency group is global, not per branch: there is one preview container,
so two dispatches must queue rather than race. The job declares
`environment: preview`, which is what produces the OIDC subject the role trusts.
`workflow_dispatch` already runs against whichever ref is selected in the UI, so
`actions/checkout` gets the branch with no extra input.

The `preview` Environment must keep its deployment branch policy at "all
branches". Restricting it to `main` would defeat the entire feature, since the
point is dispatching from a PR branch.

Steps, with the two additions to the normal Deploy marked:

1. Checkout, configure AWS credentials with the preview role, log in to ECR.
2. Read `/eecs-capstone-preview/ASSETS_PUBLIC_BASE` from SSM.
3. Build and push `preview-<sha>` with `VITE_STORAGE_PUBLIC_BASE` and
   `VITE_PREVIEW_BANNER=1`.
4. Register the task definition, swapping the image exactly as
   `.github/workflows/deploy.yml:73-88` does.
5. **New.** Start the RDS instance if stopped, then wait for `available`.
6. **New.** Reset the database: one-off task overriding the command to
   `node scripts/reset-preview-db.mjs`. Skipped when `reset_db` is false.
7. Run migrations: one-off task, `node scripts/migrate.mjs`, identical to
   production.
8. **New.** Seed: one-off task, `node dist-ops/seed-dev.mjs`.
9. Update the service to `desired_count = 1` and wait for stable.
10. Write the preview URL to `$GITHUB_STEP_SUMMARY`.

All three one-off tasks run against the full preview task definition rather than
a stripped override. `src/db/index.ts` throws at module scope without
`DATABASE_URL`, and `src/lib/auth.ts:10` calls `getEmailSender()` at module
scope, which throws without `EMAIL_FROM` under `EMAIL_TRANSPORT=ses`
(`infra/ecs.tf:104-109` documents that coupling). Nothing may run with a partial
environment.

Each one-off task reuses the preview service's `networkConfiguration`, read from
`describe-services`, as production's workflow does. That works with
`desired_count = 0`, because the network configuration lives on the service, not
on its tasks.

When `stop` is true the workflow skips steps 2 through 9, sets the service to
`desired_count = 0`, and calls `stop-db-instance`. RDS restarts an instance
itself after seven days, which the documentation states.

## Phase 2: one preview per pull request

Not specced to implementation depth. Recorded here so the phase 1 build does not
foreclose it, and so the decision to build it can be made on facts.

### The gating question

**Can several CloudFront distributions share one `aws_cloudfront_vpc_origin`?**
If yes, spinning up a PR preview is roughly five minutes and phase 2 is worth
building. If each distribution needs its own VPC origin, every PR costs 15 to 30
minutes to create and the same again to tear down (`infra/cloudfront.tf:2`), and
it is not.

Phase 1 answers this, because its preview distribution reuses production's VPC
origin. Do not start phase 2 until phase 1 has applied and shown which way it
went. Everything else below is mechanical.

### Shape

Per PR: one CloudFront distribution, one ALB listener rule (priority derived
from the PR number), one target group, one ECS service, one database. Shared:
the VPC origin, the ALB, the cluster, the ECR repository, the RDS instance, the
S3 bucket, and the SES identity.

Created and destroyed by the workflow with the AWS CLI rather than Terraform.
Per-PR resources are ephemeral and Terraform state would need locking per PR;
the create path is roughly five calls and the destroy path the same.

### URLs

Each PR's own distribution serves on its own `*.cloudfront.net` name, with valid
TLS and no DNS work. The alternatives are worse. A wildcard host scheme needs
`*.preview.eecs.oregonstate.edu` issued and delegated, because the existing
`*.eecs.oregonstate.edu` certificate matches exactly one label and will not
cover `pr-123.preview.eecs.oregonstate.edu`. Path-based routing would need the
app served under a base path, which breaks cookie scope, the Better Auth
callback URL, and asset paths.

The banner gains a `VITE_PREVIEW_LABEL` build arg carrying the PR number and
branch.

### Database

`CREATE DATABASE eecs_capstone_pr_<n>` on the shared preview instance, then
migrate, then seed. Extra databases on an existing instance are free. Dropped on
teardown.

A single shared database across all PRs does not work: the point is testing
branch code, branch code includes migrations, and two open PRs with different
migrations collide on the first apply.

The cap on concurrent previews is connections, not cost. `src/db/index.ts` calls
`drizzle(databaseUrl)` with no pool configuration, so it takes the
node-postgres default of 10, and `db.t4g.micro` allows roughly 112. That puts
the ceiling near 3 to 5 concurrent previews. The workflow should refuse to
create one beyond the cap rather than fail obscurely at connection time.

### Lifecycle

Deploy on `pull_request: [labeled]` for a `preview` label plus `synchronize`
while the label is present. Tear down on `pull_request: [closed]`, which covers
merge and close alike, plus a scheduled reaper for previews whose close event
was missed and for any preview older than a fixed age.

Label-gating rather than deploying every PR is deliberate. Vercel previews are
cheap idle because the compute is serverless; a Fargate task runs until stopped,
so an open preview costs roughly $9 a month whether or not anyone opens the URL.
Copying the per-PR shape without copying scale to zero buys the complexity of N
environments and the cost of N environments.

### Two hard constraints

**Fork PRs cannot deploy.** A `pull_request` workflow from a fork runs untrusted
code. Giving it an OIDC token that can create ECS services and pass IAM roles is
the hole, not an inconvenience to engineer around.

**The reviewer gate fights the automation.** `environment: preview` with
required reviewers prompts on every deployment, including every push to an open
PR. Without required reviewers, the environment-scoped subject means any branch
can assume the role, so repo write access implies preview-deploy rights. Label
gating narrows who triggers it, since applying a label needs write access, but
it cannot be expressed as an environment branch policy, so it is a convention
rather than an enforced boundary. This trade has to be decided before phase 2
ships.

## Cost

| Item | ~$/mo |
|------|------|
| Fargate (0.25 vCPU / 0.5 GB, 1 task) | 9 |
| RDS `db.t4g.micro` compute | 12 |
| 20 GB gp3 storage | 2 |
| CloudFront, S3, ECR | 1 |
| **Total, always on** | **~24** |
| **Total, after a `stop` dispatch** | **~3** |

A stopped RDS instance bills storage only, and `backup_retention_period = 0`
means no snapshot charges. There is no new ALB, which is what keeps this well
under production's ~$40 to $50: a second internal ALB would have added $17 by
itself.

Phase 2 adds roughly $9 per concurrently open preview.

## Testing

Unit tests beside the existing `src/lib/email/__tests__`:

- The subject prefix is applied, and is absent when the variable is unset.
- A recipient at a listed domain is rewritten to
  `success+<localpart>@simulator.amazonses.com`.
- A recipient at an unlisted domain passes through untouched.
- Neither variable set leaves the transport's behaviour byte-identical.

A render test for `PreviewBanner`: present when the flag is set, absent when it
is not. A contrast assertion in the Playwright axe suite, since the banner is on
every page and introduces new color tokens.

`npm run build` covers the seed bundle, so CI fails if `seed-dev.ts` grows an
import the runtime image cannot resolve.

Manual verification after the first apply, as a checklist in `DEPLOYMENT.md`:
the banner appears, the URL is not production's, sign-in works with a seeded
account and the shared password, GitHub sign-in completes against the preview
OAuth app, a verification email arrives in the SES sending statistics with a
`[PREVIEW]` subject and no bounce, and a second dispatch resets the data.

## Documentation

- `DEPLOYMENT.md` gains a section 14, appended rather than inserted.
  Renumbering would silently invalidate hand-written cross-references in
  `infra/*.tf`, which cite section numbers (`infra/ecs.tf` cites section 9,
  `infra/cloudfront.tf:31` cites section 3.7).
- `docs/QUIRKS.md` gains two entries: Drizzle's migration ledger living in the
  `drizzle` schema rather than `public`, and the environment-scoped OIDC subject
  dropping the branch ref.
- `.env.example` gains `EMAIL_SUBJECT_PREFIX` and `EMAIL_SIMULATOR_DOMAINS`,
  both blank, with a note that they are preview-only.
- The `README.md` roadmap bullet is rewritten to record the decision, following
  the pattern set by commit `eae6c7b`.

## Risks

**A preview tester's own address still receives real mail.** The containment
covers seeded data. An address typed into the sign-up or proposal form on
preview is neither seeded nor at `example.com`, so it sends for real, carrying
only the `[PREVIEW]` subject prefix. Accepted deliberately: the alternative,
redirecting every recipient to one inbox, was considered and rejected.

**Preview shares production's ALB.** A malformed listener rule affects
production traffic. The rule is additive and the default action is untouched,
but the blast radius is not zero. A separate ALB removes it for $17 a month.

**The custom header is a shared secret in Terraform state.** Anyone who can read
state can reach the preview environment through the internal ALB. Preview holds
only seeded data, so the exposure is the environment's existence, not its
contents.

**Three AWS behaviours are unverified, all answered by the first apply.**
Whether `custom_header` is accepted alongside `vpc_origin_config`; whether an
origin custom header overrides a same-named viewer header; and whether two
distributions may share one VPC origin. The first two gate phase 1's routing and
share a fallback. The third gates phase 2 and is answered as a side effect of
phase 1 working.

## Out of scope

- A custom hostname for preview. The CloudFront default name avoids an OSU DNS
  ticket with an unknown wait. Adding `capstone-preview.eecs.oregonstate.edu`
  later needs only a CNAME and an `aliases` entry, since the existing
  `*.eecs.oregonstate.edu` certificate already covers it.
- Terraform workspaces or a second `var.project`. Rejected with the isolation
  decision; a full second stack roughly doubles the bill.
- Seeding uploaded images into the preview S3 bucket. The seeds reference
  placeholder assets already in the image.
- Automatic promotion of a preview image to production. Production builds from
  `main` and keeps its own ECR repository, deliberately.
