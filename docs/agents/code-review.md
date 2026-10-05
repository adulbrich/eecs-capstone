# Code review

`mattpocock-skills:code-review` runs on every pull request, as `AGENTS.md` says. It
checks conformance. `correctness-review` under `.claude/skills/` runs beside it on
every pull request that changes behaviour and checks whether the change is wrong;
`app-security-review` is the optional security pass (#544). Two local deltas from
the skill's default brief:

- **The Standards axis reads these sources and no others:** `AGENTS.md`,
  `docs/QUIRKS.md`, `docs/UI-CONVENTIONS.md`, `CONTEXT.md`, and the ADRs under
  `docs/adr/` that touch the diff. Grep them for the sections the diff reaches.
  `README.md`, `DEPLOYMENT.md`, `PRD.md` and `CONTRIBUTING.md` describe the project,
  not how its code is written, so they are not standards sources.
- **A UI change carries screenshots, and the reviewer checks both widths.** A
  pull request whose diff touches `src/routes/`, `src/components/` or
  `src/styles.css` must have a `## Screenshots` section with an image or the
  line `Screenshots: none, because <reason>`; `scripts/check-pr-screenshots.mjs`
  enforces that much in the `pr-text` workflow (#342). The template asks for a
  desktop and a 375px image per changed page, and a script cannot tell the two
  apart, so when the section has images the Spec axis reports a page that shows
  only one width as a finding.
