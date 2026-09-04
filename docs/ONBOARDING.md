# Onboarding

Day one for a developer or an instructor colleague joining this repo. `README.md`
is how to run the app, `CONTRIBUTING.md` is how work moves through the repo; this
is what sits around both: the accounts you need, the setup wizard, what Claude Code
will do in your terminal, and a first week.

## Accounts and access

- **The GitHub repository**, `adulbrich/eecs-capstone`. Ask the maintainer for
  write access; everything is a branch and a pull request, and the `main` ruleset
  rejects a direct push from anyone, the maintainer included. Install the `gh` CLI
  and sign in (`gh auth login`); the issue tracker is driven with it.
- **The AWS account**, only if you will deploy. Production is one ECS task behind
  CloudFront, provisioned by Terraform under `infra/`. `DEPLOYMENT.md` section 2
  lists what to install and what access to ask for; nothing in local development
  touches AWS, and the Bedrock features degrade to an error message without
  credentials.
- **ONID sign-in needs nothing from you.** UIT registered the app as a relying
  party on 2026-08-24 and issues the client secret; the discovery URL and client id
  are public values already in `.env.example`. Locally, sign in with the seeded
  email and password accounts. `docs/ONID-SSO.md` has the operating notes if you
  ever hold the secret.
- **A GitHub OAuth app** is optional and personal: register one only to exercise
  the GitHub sign-in button locally. The wizard offers the step.

## Local setup

Run the wizard from a fresh clone:

```bash
bash scripts/onboard.sh
```

It walks the steps a person has to be present for, from the Node in `.nvmrc`
through docker, `.env.local`, migrations, the seed and the Playwright browser to
every suite once, and it stops at the first one that fails with a pointer at
where to read. It asks before the suites, because the integration one empties the
dev database. Re-running it is safe; it keeps what `.env.local` already holds.

`README.md` covers the same steps by hand, the port-conflict case, and the email
transport. Do not read it for the roadmap: that is GitHub Issues.

The seed creates one account per role, among others, all with the password
`password`:

| Address | Role |
| --- | --- |
| `user@example.com` | user |
| `instructor@example.com` | instructor |
| `admin@example.com` | admin |

## Claude Code

The repo is configured for Claude Code, and most of the recent history was written
with it under the review loop in `CONTRIBUTING.md`. Working here without it is
fine; working here with it means knowing what it will do on your behalf.

**Install.** The desktop app, or `npm install -g @anthropic-ai/claude-code`, then
`claude` in the repo. `CLAUDE.md` is a symlink to `AGENTS.md`, which is what it
loads as project instructions; do not replace the symlink with a copy.

**The trust prompt.** `.claude/settings.json` declares the
`claude-plugins-official` marketplace and enables the `mattpocock-skills` plugin
from it. Claude Code asks once, per operator, whether to trust that marketplace.
Answer yes: the `code-review` skill every pull request has to pass comes from that
plugin, and without it the review loop in `AGENTS.md` cannot run. Nothing else is
installed by the prompt.

**The hooks.** The same settings file installs five hooks under `.claude/hooks/`,
which run inside your session and refuse the commands the rules forbid before they
execute:

| Hook | When | What it does |
| --- | --- | --- |
| `session-context.mjs` | session start | Prints the branch, working tree, Node against `.nvmrc`, and the running compose services. |
| `guard-git.mjs` | before a `git` command | Refuses `add -A`, `commit -a`, a commit on `main`, a force push at `main`, `reset --hard`, `checkout .`, `restore .`, `clean -f`, `branch -D`, and a commit message that fails the commit check. |
| `guard-gh.mjs` | before a `gh` command | Refuses PR or issue text with an emdash, an emoji, a session link, or a title that is not a Conventional Commits subject. |
| `guard-edits.mjs` | before an edit | Refuses edits to the generated and personal files: the route tree, the auth schema, `CLAUDE.md`, `.env` and `.env.local`. |
| `after-edit.mjs` | after an edit | Reports Biome and the prose rule on the edited file. |

A refusal from the git guard looks like this in the session, and the agent is
expected to change what it was about to do rather than retry; the edit guard
answers with a structured denial carrying the same kind of reason:

```
PreToolUse:Bash hook error: Stage files by name (AGENTS.md): `git add -A` and
`git add .` sweep up unrelated work in progress. Name the paths.
```

The hooks are the middle column of the gates table in `CONTRIBUTING.md`; lefthook
and CI run the same scripts, so a rule has one implementation.

**Two things the sandbox refuses.** Claude Code runs shell commands in a sandbox by
default, and two ordinary commands fail inside it in ways that look like the tool
being broken: `gh` fails TLS, and anything that writes `.git/config` (`git branch
-d`, `git worktree add`, `git remote`) half-completes. The agent runs those with
the sandbox off; the Vitest section of `docs/QUIRKS.md` has the third case, which
is Vitest itself.

**What it reads first.** `AGENTS.md` for the rules, `CONTEXT.md` for the words,
`docs/adr/` for the decisions, `docs/QUIRKS.md` for the gotchas, and
`docs/agents/` for how the engineering skills use the issue tracker and the
labels. Those are the same five you should read.

## The first week

1. **Run every suite once.** The wizard did it; do it again by hand from
   `CONTRIBUTING.md`, "Which suites to run yourself", so you know what each one
   costs and what it leaves behind.
2. **Read `CONTEXT.md`, then `docs/adr/`.** The glossary is short and every issue
   title, test name and commit uses its words. The thirteen ADRs are one
   paragraph each and are what an architecture review would otherwise re-propose.
3. **Read `PRD.md` once**, so you stop assuming a feature is missing.
4. **Take an issue.** Filter for `ready-for-human` and `p2-later`:

   ```bash
   gh issue list --state open --label ready-for-human --label p2-later
   ```

   Assign yourself, branch from a fresh `origin/main`, and go through the process
   in `CONTRIBUTING.md` end to end, review loop included. A small documentation
   or test issue is the right first one; the point is the loop, not the change.
5. **File what you found.** A gotcha goes in `docs/QUIRKS.md`, a term in
   `CONTEXT.md`, a decision in `docs/adr/`, and a request in a GitHub issue
   through the forms under `.github/ISSUE_TEMPLATE/`.
