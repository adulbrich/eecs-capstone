# Markdown Formatting in Project Fields

Date: 2026-07-22
Status: Approved design, ready for implementation planning

## Summary

Project long-text fields are stored as plain `text` and rendered with
`whitespace-pre-wrap`. Proposers cannot express structure: a list of minimum
qualifications is a run of lines, and a problem statement cannot emphasise a
key term. The README roadmap asks for "rich text formatting (or markdown) in
project edit fields (e.g., bullet lists for requirements)".

This design adds markdown as the authoring and storage format for the six long
project fields. Nothing changes in the database: markdown source lives in the
same `text` columns it lives in today, because existing plain text is already
valid markdown. The project form gains a `MarkdownField` component (a textarea
with a formatting toolbar and a preview tab), and the project detail page
renders markdown through `react-markdown` into React elements rather than an
HTML string.

Markdown source, rather than HTML, is the storage format specifically because
two existing subsystems read these columns directly: the generated
`projects.search_vector` (`src/db/schema.ts:108-111`) and the Bedrock review
path (`IMPROVABLE_FIELDS` in `src/lib/project-review-fields.ts`). Markdown
degrades gracefully in both. HTML would flood the tsvector with tag names and
hand the AI reviewer markup instead of prose.

## Goals

- Let proposers write bullet lists, numbered lists, bold, italic, links, and
  inline code in the six long project fields.
- Keep the stored value human-readable so full-text search and AI review
  continue to operate on essentially the same text they see today.
- Introduce no schema migration and no data migration.
- Render markdown without `dangerouslySetInnerHTML`, per the project's code
  standards.
- Keep card and row listings visually unchanged: summaries stay plain text.

## Non-goals (out of scope for this release)

- A WYSIWYG/ProseMirror editor. Rejected in favour of markdown source, see
  Decisions.
- Markdown in project comments, inventory descriptions, or program
  descriptions. Those may follow later; they are separate components with
  separate render paths.
- Markdown in `title`. Titles appear in cards, rows, page titles, and
  notification text; they stay plain.
- Images or embedded HTML inside markdown. Project images have a dedicated
  upload and crop flow.
- Re-weighting or rebuilding `search_vector`. See Decisions.

## Decisions

- **Markdown source is the storage format, in the existing columns.** No new
  column, no migration, no backfill. Every existing plain-text value is already
  a valid markdown document. The reverse (migrating to HTML) would require a
  one-way conversion of every existing row.
- **`react-markdown` + `remark-gfm`, not a markdown-to-HTML string.**
  `react-markdown` produces React elements, so there is no HTML string to
  inject and no `dangerouslySetInnerHTML` call to justify. This removes the
  sanitizer dependency (`dompurify`) that a `marked`-style pipeline would
  require, and it satisfies the standing rule in `.claude/CLAUDE.md` directly
  rather than by exception. Raw HTML in the source is ignored by default
  because `rehype-raw` is deliberately not installed.
- **No `remark-breaks` (user decision).** Standard markdown paragraph
  semantics apply: a single newline is a soft wrap, a blank line starts a new
  paragraph. Consequence, accepted knowingly: existing content authored against
  the current `whitespace-pre-wrap` behaviour, where every newline is a visible
  break, will reflow into single paragraphs on first render. The Preview tab
  makes this visible to authors, and any owner or staff member can fix a
  project by adding blank lines. See Risk callouts.
- **Headings are clamped to `h3`.** The detail page already establishes an
  `h1` (project title) / `h2` (section label) hierarchy, so an author heading
  belongs at `h3`. `#` through `######` all render as `h3`.

  Corrected during implementation. This originally said `h4`, justified as
  protecting heading order. That was wrong twice over. An `h4` directly under
  an `h2` skips `h3` and is itself the violation it claimed to prevent, and
  `staff-project-panel.tsx` already uses `h3` under those same `h2`s. The
  supporting claim was also false: `src/test/a11y/helpers.ts:12` filters axe to
  `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa`, and axe classifies
  `heading-order` as `best-practice`, so that suite never checked heading order
  and could not have caught either the original error or an author-controlled
  `h1`. All six levels stay in `allowedElements` so they can be remapped;
  removing them would make `unwrapDisallowed` flatten `# Foo` into a bare
  paragraph instead.
- **Links get `rel="noopener noreferrer"` and `target="_blank"`** via a custom
  `a` renderer, per the project's security standards.
- **`search_vector` is left alone.** `to_tsvector` treats `*`, `-`, `#`, and
  `_` as punctuation, so `**telemetry**` lexes to `telemetri` exactly as
  `telemetry` does, and `- ingests sensor data` lexes to the three content
  words. The one real addition is link targets: Postgres tokenizes URLs into
  `url` and `host` lexemes, so a markdown link contributes its destination as
  well as its text. That is closer to useful than harmful, and it is already
  true of any bare URL pasted into a field today. Rebuilding the column would
  mean dropping and re-adding a generated column (see `docs/QUIRKS.md`) for no
  measurable gain.
- **Card and row summaries are stripped, not rendered.** `ProjectCard` and
  `ProjectRow` `line-clamp` the raw description. Rendering markdown there would
  fight the clamp; leaving it raw would leak `**` into listings. A pure
  `stripMarkdown()` helper solves both.

## Fields in scope

The six multi-line fields on the project form:

| Column                | Form label                | Search weight |
| --------------------- | ------------------------- | ------------- |
| `description`         | Description               | B             |
| `problemStatement`    | Problem statement         | B             |
| `objectives`          | Objectives / deliverables | C             |
| `minQualifications`   | Minimum qualifications    | C             |
| `prefQualifications`  | Preferred qualifications  | C             |
| `licenseRestrictions` | License / IP restrictions | not indexed   |

This is `IMPROVABLE_FIELDS` minus `title`, so the AI review round trip (request
a suggestion, apply it into the field) stays consistent across the whole set.

## Components

### `src/components/markdown-field.tsx`

Wraps the existing `Textarea` and keeps its current TanStack Form wiring,
character counter, and AI-suggestion affordance intact.

- Toolbar: bold, italic, bullet list, numbered list, link. Each button is a
  `type="button"` with an `aria-label` and a visible icon from `lucide-react`.
- Tabs: Edit and Preview. Preview renders the current draft value through the
  same `Markdown` component the detail page uses, so what an author previews is
  exactly what publishes.
- Insertion behaviour lives in a pure, unit-testable helper that takes
  `(value, selectionStart, selectionEnd, action)` and returns
  `{ value, selectionStart, selectionEnd }`. Wrapping actions (bold, italic,
  link) wrap the selection or insert a placeholder when the selection is empty.
  List actions prefix each selected line.
- The component applies the result with `document.execCommand("insertText")`
  when available, so the browser's native undo stack survives, and falls back
  to `setRangeText` plus a dispatched `input` event otherwise.

### `src/components/markdown.tsx`

The single render path, used by both the detail page and the Preview tab.

- `react-markdown` with `remark-gfm`.
- `allowedElements`: `p`, `strong`, `em`, `del`, `ul`, `ol`, `li`, `a`, `code`,
  `pre`, `blockquote`, `hr`, `h1`-`h6`, `table`, `thead`, `tbody`, `tr`, `th`, `td`.
  `unwrapDisallowed` is set so disallowed nodes keep their text content.
- `components`: `a` adds `rel`/`target`; `h1`-`h6` all map to `h3`.
- Rendered inside `prose prose-sm max-w-none dark:prose-invert` from
  `@tailwindcss/typography`, which is already installed and enabled in
  `src/styles.css:2`.
- Renders `null` for empty or whitespace-only input.

### `src/lib/strip-markdown.ts`

A pure function removing emphasis markers, list bullets, heading hashes, link
syntax (keeping the link text), and code fences, then collapsing whitespace.
Used by `ProjectCard`, `ProjectRow`, and anywhere else a project description
appears as a one-line or clamped summary. Deliberately simple string
processing, not a parser: it runs on every card in a listing.

## Changes to existing files

- `src/components/project-form.tsx`: the six `Textarea` fields become
  `MarkdownField`. Validators are unchanged (`description` stays
  `z.string().max(5000)`); the limit now counts markdown syntax, which is
  documented in the field hint.
- `src/routes/projects/$projectId.tsx`: the `Section` component's
  `<p className="mt-1 whitespace-pre-wrap">{body}</p>` (line 239) becomes
  `<Markdown>{body}</Markdown>`.
- `src/components/project-card.tsx` and `src/components/project-row.tsx`: the
  clamped description becomes `stripMarkdown(project.description)`.
- `src/server/_internal/project-review-core.ts`: the prompt gains a statement
  that these fields are markdown and that suggestions must be returned as
  markdown, so applying a suggestion does not silently strip an author's
  formatting.

## Dependencies

`react-markdown` and `remark-gfm`, both runtime dependencies. No sanitizer is
needed because no HTML string is produced and raw HTML passthrough is not
enabled.

## Testing

- Unit: the toolbar insertion helper, over empty selection, single-line
  selection, and multi-line selection, for each action.
- Unit: `stripMarkdown` over bullets, emphasis, links, headings, and code
  fences, including the identity case of already-plain text.
- Unit: the `Markdown` component renders a list, bold text, and a link with
  `rel="noopener noreferrer"`; and does not render a `<script>` or an `<img>`
  present in the source.
- Unit: `#`-prefixed lines render as `h3`, not `h1`.
- Accessibility (Playwright): the project detail page and the project form keep
  a clean axe run, with heading order preserved on a project whose fields
  contain markdown headings.

## Risk callouts

- **Existing content reflows.** Without `remark-breaks`, projects whose fields
  rely on single newlines render as continuous paragraphs. This is the one
  user-visible regression in this design and it was accepted deliberately. Two
  things soften it: the Preview tab shows authors the true rendering while they
  edit, and the AI review path can be pointed at a poorly formatted field to
  propose a structured rewrite. If the reflow proves worse than expected on
  real data, `remark-breaks` is a one-line addition to the render pipeline.
- **The 5000-character limit now includes syntax.** A heavily formatted
  description has less room for prose. The limit is unchanged for now; if
  authors hit it, raising it is a validator edit on both client and server.
