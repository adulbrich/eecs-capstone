# Code review

`mattpocock-skills:code-review` runs on every pull request, as `AGENTS.md` says.
One local delta from the skill's default brief:

- **A UI change carries screenshots, and the reviewer checks both widths.** A
  pull request whose diff touches `src/routes/`, `src/components/` or
  `src/styles.css` must have a `## Screenshots` section with an image or the
  line `Screenshots: none, because <reason>`; `scripts/check-pr-screenshots.mjs`
  enforces that much in the `pr-text` workflow (#342). The template asks for a
  desktop and a 375px image per changed page, and a script cannot tell the two
  apart, so when the section has images the Spec axis reports a page that shows
  only one width as a finding.
