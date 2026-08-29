# Promote the smoke check to required

This file exists to give this pull request a diff. Delete it as part of merging.

The actual change is a repository ruleset edit, which is not in version control
and needs repo admin. Add `smoke / suite` to the required status checks on
ruleset 20613762, beside `verify`.

## The name

Register **`smoke / suite`**, not `smoke`. A `workflow_call` reference renders a
check as `<caller job> / <called job>`, and the caller job `smoke` in
`.github/workflows/ci.yml` invokes the job `suite` in `stack-suite.yml`.
Registering the bare name leaves a required check that never resolves, which
blocks every pull request indefinitely rather than failing loudly.

## When

After roughly ten green runs, or a week, whichever comes first. The suite landed
advisory on purpose: a new browser suite on a shared runner has an unknown flake
rate, and learning that number by blocking every open pull request for a day
costs far more than a week of watching.

Check before merging this:

```bash
gh run list --workflow=ci.yml --branch=main --limit 15 \
  --json conclusion,displayTitle,createdAt
```

If any run failed for a reason that was not a real regression, fix or demote
that test first. A smoke test that flakes twice gets fixed or moved to the full
suite (#143), never retried harder.

## Reading the ruleset

The list endpoint does not carry the rules, so it takes two calls:

```bash
gh api repos/adulbrich/eecs-capstone/rulesets --jq '.[].id'
gh api repos/adulbrich/eecs-capstone/rulesets/<id> \
  --jq '.rules[] | select(.type=="required_status_checks")'
```

Refs #23.
