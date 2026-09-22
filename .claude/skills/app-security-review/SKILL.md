---
name: app-security-review
description: Review the changes since a fixed point (commit, branch, tag, or merge-base) for the five security classes this app has actually shipped fixes for and a generic security review filters out by policy: trust of forwarding headers, sign-in and lockout state, user text reaching a Bedrock prompt, secrets or addresses reaching a log, and role checks at the server boundary. Use when a diff touches src/server, src/lib, infra, or any prompt or logger.
---

Security review of the diff between `HEAD` and a fixed point the user supplies,
scoped to what a generic security review does not cover. Two read-only sub-agents
run in parallel: one on what enters the app, one on what leaves it.

It is the complement of a generic security review, not a replacement: the classes
here are the ones such a review excludes by policy and this repo has shipped fixes
for. Run the generic review beside it; see _Why_.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point. If they did not name one, ask. Capture the
diff command once, `git diff <fixed-point>...HEAD` (three-dot, against the
merge-base), and the commit list, `git log <fixed-point>..HEAD --oneline`.

Confirm `git rev-parse <fixed-point>` resolves and the diff is non-empty before
spawning anything.

### 2. The checklist

Each entry reads _what it is_, then _how to find it_. Paste the whole list into
both sub-agent prompts: the sub-agent has no other access to it.

- **Trust of a forwarding header (#520, #556).** Code that reads `X-Forwarded-For`,
  `Host`, or a proxy list and assumes what each hop wrote there. Find it: for each
  hop the code or its comments assume (CloudFront, the load balancer, a VPC
  address), cite the vendor's documentation for what that hop appends, and compare
  it to what the code reads as the viewer. A test fixture that hand-writes the chain
  is not evidence about the chain. A wrong assumption here rate-limits strangers and
  records the wrong address on the session; report it even though rate limiting is
  out of scope for a generic review.
- **Sign-in and lockout state (#551, #557).** A counter, key, window or ban that
  decides whether a sign-in may proceed. Find it: name what the key resolves to for
  a shared campus address, a NAT, an unresolved IP, and an address that differs only
  in case, and say who gets locked out, or who gets through, in each case.
- **User text reaching a model prompt.** Proposer or staff prose that lands in a
  Bedrock call (project review, scope assessment, social summary, embeddings). Find
  it: for each prompt, list which fields are editable by which role, whether the
  model's output is constrained to a schema, and who reads the output. A field a
  proposer edits that steers text published under the university's name is a
  finding, whatever a generic review's policy says about prompts.
- **A secret or an address reaching a log (#559).** An error object, a request, or
  a URL passed to any console method or logger. Find it: every logging call in the
  diff, and what the value carries. A Drizzle query error interpolates its bound
  parameters into `message`, so `error.message` leaks the same as `error`; a session
  or reset token, an email address and a viewer IP are all bound parameters
  somewhere. ADR-0042 and the Drizzle section of `docs/QUIRKS.md` carry the rule and
  the helper.
- **Role checks at the server boundary.** A changed server function, route loader
  or API handler. Find it: name the guard it calls and the role it admits, compare
  both to the neighbouring functions in the same module and to the role definitions
  in `CONTEXT.md`, and for every id in the input say where it is checked against
  the caller rather than only for existence.

Then one technique on top of the list, for every entry point the diff adds or
changes: name the least privileged actor who can reach it (a signed-out viewer, a
user, a proposer on someone else's project) and write the request that makes it do
something for them.

A finding carries the request or the sequence that triggers it: method, path, role,
and the input. A description of the exposure is not a finding.

### 3. Spawn two sub-agents in parallel

Every prompt opens with: "You are read only. Write nothing under the repository and
nothing to any database, stage nothing, change no branch. A scratch file goes under
`$TMPDIR`; a query you want to prove runs as a read, or is reported as untested."
Every prompt
carries the diff command, the commit list, the full checklist and the technique
from step 2, and a 400-word limit on the report.

- **Inbound.** Entries: forwarding headers, sign-in and lockout state, role checks.
  Brief: "For each entry point the diff touches, apply the entry and the technique.
  Report each finding under the entry's name with the request that triggers it."
- **Outbound.** Entries: model prompts, logs. Brief: "Trace every value the diff
  sends to a model or a logger back to where it came from and forward to who reads
  it. Report each finding under the entry's name with the value and the path."

### 4. Aggregate

Present the reports under `## Inbound` and `## Outbound`, verbatim or lightly
cleaned, findings under the checklist entry names. Within each section, order
findings by how silent they are: one that corrupts a session row or locks out a
stranger without a log line comes before one that fails loudly. Keep the sections
separate. End with one line per section: finding count and the most silent finding
in it. Name no winner across sections.

## Why

A generic security review is tuned for a low false-positive rate on the classes
every web app shares, and its exclusions are the price: "logging URLs is assumed to
be safe", "including user-controlled content in AI system prompts is not a
vulnerability", and rate limiting and lockout are out of scope. In this repo a
logged query error carried the session token (#559), the rate limiter keyed on a
CloudFront edge address until #556 applied `preserve`, and a shared campus address
was one sign-in bucket until #557 counted per account. Each was a security defect
the generic review would have filtered, so this skill carries only those classes
and leaves the shared ones to the tool built for them. A harness with no built-in
review covers the generic classes by hand against its category list: injection,
authentication bypass, secrets in code, XSS and deserialization.
