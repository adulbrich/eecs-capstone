Closes #

<!-- What changed and why, from the reader's side. Two to five bullets. -->

-

## Ran locally

<!-- Keep the lines that ran, delete the rest. `check`, `typecheck` and `test`
     run at pre-push; the stack suites are yours to choose per CONTRIBUTING.md. -->

- `npm run check`, `npm run typecheck`, `npm test`
- `npm run test:integration` (database layer touched)
- `npm run test:smoke` (a covered flow touched)
- `npm run test:accessibility:smoke` (a scanned page touched)

## Screenshots

<!-- Required when the diff touches src/routes/, src/components/ or
     src/styles.css (scripts/check-pr-screenshots.mjs, run by pr-text). One
     image per changed page at desktop and at 375px, or the opt-out line.
     Keep one of the two lines below, delete the other. -->

![page at desktop](url) ![page at 375px](url)

Screenshots: none, because ...

## Review loop

<!-- AGENTS.md: mattpocock-skills:code-review until a pass raises nothing
     unanswered. State the pass count. A declined finding gets one line. -->

- Passes:
- Declined:

## Docs

<!-- QUIRKS, an ADR, CONTEXT.md, UI-CONVENTIONS, or "none, because". -->

-
