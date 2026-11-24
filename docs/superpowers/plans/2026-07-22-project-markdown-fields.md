# Markdown in Project Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let proposers write bullet lists, emphasis, and links in the six long project fields, stored as markdown source in the columns those fields already use.

**Architecture:** Markdown source stays in the existing `text` columns, so there is no migration and no backfill. One `Markdown` component renders it into React elements via `react-markdown`, which means no HTML string is ever produced and `dangerouslySetInnerHTML` is never needed. The project form's shared `Field` component grows a `markdown` mode backed by a pure toolbar-edit helper, and card/row summaries run through a `stripMarkdown` helper so listings stay plain text.

**Tech Stack:** TanStack Start (React SSR), TanStack Form, `react-markdown` + `remark-gfm`, `@tailwindcss/typography` (already installed and enabled at `src/styles.css:2`), Vitest + Testing Library.

Source spec: `docs/superpowers/specs/2026-07-22-project-markdown-fields-design.md`

## Global Constraints

- The six markdown fields are exactly: `description`, `problemStatement`, `objectives`, `minQualifications`, `prefQualifications`, `licenseRestrictions`. `title` and `notes` stay plain.
- No database migration. No change to `projects.search_vector`.
- Never use `dangerouslySetInnerHTML`. Never install or enable `rehype-raw`.
- Rendered headings are always `h4`, whatever level the author wrote. The page's `h1`/`h2` hierarchy is owned by the route.
- Links render with `rel="noopener noreferrer"` and `target="_blank"`.
- Regex literals live at module top level, never inside functions or loops (project code standard).
- Run `npm run check` before every commit and fix all findings.
- Component tests live in `src/test/<name>.test.tsx` and need `// @vitest-environment jsdom` on line 1.
- `@testing-library/jest-dom` is NOT installed. Use plain Vitest matchers only.

---

## File Structure

**Created:**

- `src/lib/strip-markdown.ts`: pure markdown-to-plain-text reducer for summaries.
- `src/lib/__tests__/strip-markdown.test.ts`
- `src/lib/markdown-toolbar.ts`: pure editor-edit calculator, no DOM.
- `src/lib/__tests__/markdown-toolbar.test.ts`
- `src/components/markdown.tsx`: the single render path.
- `src/test/markdown.test.tsx`
- `src/components/markdown-field.tsx`: textarea + toolbar + preview.
- `src/test/markdown-field.test.tsx`

**Modified:**

- `src/components/project-card.tsx:63-65` and `src/components/project-row.tsx:31-35`: strip summaries.
- `src/routes/projects/$projectId.tsx:232-242`: render the detail sections as markdown.
- `src/components/project-form.tsx`: `Field` gains a `markdown` mode; six call sites switch to it.
- `src/server/_internal/project-review-core.ts:57`: teach the prompt that fields are markdown.

---

## Task 1: `stripMarkdown` and plain-text summaries

**Files:**

- Create: `src/lib/strip-markdown.ts`
- Create: `src/lib/__tests__/strip-markdown.test.ts`
- Modify: `src/components/project-card.tsx:62-66`
- Modify: `src/components/project-row.tsx:31-35`

**Interfaces:**

- Consumes: nothing.
- Produces: `export function stripMarkdown(input: string | null | undefined): string`. No later task depends on it, but the card and row both call it in this task.

**Context:** `ProjectCard` and `ProjectRow` both `line-clamp-3` the raw `project.description`. Once descriptions contain markdown, `**bold**` and `- ` would leak into listings. This runs on every card in a listing, so it is deliberate string processing rather than a parser.

This task ships first because it is fully independent: it protects the listings before any markdown can be authored.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/strip-markdown.test.ts`:

````ts
import { describe, expect, it } from "vitest";
import { stripMarkdown } from "#/lib/strip-markdown";

describe("stripMarkdown", () => {
  it("returns an empty string for nullish input", () => {
    expect(stripMarkdown(null)).toBe("");
    expect(stripMarkdown(undefined)).toBe("");
    expect(stripMarkdown("")).toBe("");
  });

  it("leaves plain text untouched", () => {
    expect(stripMarkdown("A plain description.")).toBe("A plain description.");
  });

  it("flattens bullet lists", () => {
    expect(stripMarkdown("- ingests sensor data\n- stores it")).toBe(
      "ingests sensor data stores it"
    );
  });

  it("flattens numbered lists", () => {
    expect(stripMarkdown("1. first\n2. second")).toBe("first second");
  });

  it("removes emphasis markers", () => {
    expect(stripMarkdown("a **telemetry** pipeline")).toBe(
      "a telemetry pipeline"
    );
    expect(stripMarkdown("an *italic* word")).toBe("an italic word");
    expect(stripMarkdown("~~struck~~ out")).toBe("struck out");
  });

  it("keeps link text and drops the target", () => {
    expect(stripMarkdown("see [the docs](https://example.com/x)")).toBe(
      "see the docs"
    );
  });

  it("keeps image alt text and drops the target", () => {
    expect(stripMarkdown("![a rover](rover.png) here")).toBe("a rover here");
  });

  it("removes heading markers", () => {
    expect(stripMarkdown("# Heading\n\nBody")).toBe("Heading Body");
  });

  it("removes blockquote markers", () => {
    expect(stripMarkdown("> quoted\nplain")).toBe("quoted plain");
  });

  it("drops fenced code blocks entirely", () => {
    expect(stripMarkdown("```js\nconst a = 1;\n```\nAfter")).toBe("After");
  });

  it("unwraps inline code", () => {
    expect(stripMarkdown("run `npm test` now")).toBe("run npm test now");
  });

  it("does not mangle intra-word underscores", () => {
    expect(stripMarkdown("the snake_case_name field")).toBe(
      "the snake_case_name field"
    );
  });

  it("collapses whitespace", () => {
    expect(stripMarkdown("a\n\n\nb   c")).toBe("a b c");
  });
});
````

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/strip-markdown.test.ts`
Expected: FAIL, cannot resolve `#/lib/strip-markdown`.

- [ ] **Step 3: Write the helper**

Create `src/lib/strip-markdown.ts`:

````ts
/**
 * Reduces markdown source to plain text for clamped summaries (cards, rows).
 *
 * Deliberately regex-based rather than a real parser: this runs once per card
 * on every listing render, and the output is truncated by `line-clamp`
 * anyway. It is not a sanitizer and must never be used to render untrusted
 * markup; use the `Markdown` component for display.
 */
const CODE_FENCE = /```[\s\S]*?```/g;
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const HEADING_MARKER = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_MARKER = /^\s{0,3}>\s?/gm;
const LIST_MARKER = /^\s*([*+-]|\d+[.)])\s+/gm;
const ASTERISK_EMPHASIS = /(\*{1,3}|~~)(?=\S)([\s\S]*?\S)\1/g;
const UNDERSCORE_EMPHASIS = /(?<!\w)_{1,3}(?=\S)([\s\S]*?\S)_{1,3}(?!\w)/g;
const INLINE_CODE = /`([^`]*)`/g;
const WHITESPACE = /\s+/g;

export function stripMarkdown(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return input
    .replace(CODE_FENCE, " ")
    .replace(HORIZONTAL_RULE, " ")
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(HEADING_MARKER, "")
    .replace(BLOCKQUOTE_MARKER, "")
    .replace(LIST_MARKER, "")
    .replace(ASTERISK_EMPHASIS, "$2")
    .replace(UNDERSCORE_EMPHASIS, "$1")
    .replace(INLINE_CODE, "$1")
    .replace(WHITESPACE, " ")
    .trim();
}
````

Order matters. `HORIZONTAL_RULE` runs before `LIST_MARKER` so that `- - -` is dropped as a rule rather than half-eaten as a bullet. `IMAGE` runs before `LINK` because an image is a link with a leading `!`. The underscore rule uses `(?<!\w)` / `(?!\w)` so `snake_case_name` survives, matching GFM's own intra-word rule.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/strip-markdown.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Use it in the card**

In `src/components/project-card.tsx`, add the import:

```tsx
import { stripMarkdown } from "#/lib/strip-markdown";
```

and replace:

```tsx
{
  project.description && (
    <p className="mt-2 line-clamp-3 text-muted-foreground text-sm">
      {project.description}
    </p>
  );
}
```

with:

```tsx
{
  project.description && (
    <p className="mt-2 line-clamp-3 text-muted-foreground text-sm">
      {stripMarkdown(project.description)}
    </p>
  );
}
```

- [ ] **Step 6: Use it in the row**

In `src/components/project-row.tsx`, add the same import and replace:

```tsx
{
  project.description && (
    <p className="mt-1 line-clamp-3 text-muted-foreground text-sm">
      {project.description}
    </p>
  );
}
```

with:

```tsx
{
  project.description && (
    <p className="mt-1 line-clamp-3 text-muted-foreground text-sm">
      {stripMarkdown(project.description)}
    </p>
  );
}
```

- [ ] **Step 7: Run the component suite**

Run: `npx vitest run src/test`
Expected: PASS. `project-card.test.tsx` uses a plain-text description, which `stripMarkdown` returns unchanged.

- [ ] **Step 8: Lint and commit**

```bash
npm run check
git add src/lib/strip-markdown.ts src/lib/__tests__/strip-markdown.test.ts src/components/project-card.tsx src/components/project-row.tsx
git commit -m "feat: strip markdown from clamped project summaries"
```

---

## Task 2: The `Markdown` render component

**Files:**

- Create: `src/components/markdown.tsx`
- Create: `src/test/markdown.test.tsx`
- Modify: `package.json` (two new dependencies)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `export function Markdown({ children }: { children: string | null | undefined }): JSX.Element | null`. Tasks 3 and 4 both render this exact component.

**Context:** This is the only markdown render path in the app. The detail page uses it, and the editor's Preview tab uses it, so what an author previews is exactly what publishes.

Two subtleties that are easy to get wrong:

1. `react-markdown` filters nodes by tag name using `allowedElements` **before** applying `components`. So mapping `h1` to an `h4` renderer does not work unless `h1` is also in `allowedElements`. All six heading levels are therefore allowed and every one of them is mapped to the same `h4` renderer. The DOM only ever contains `h4`.
2. Raw HTML in the source is inert by default because `rehype-raw` is not installed. `<script>alert(1)</script>` renders as visible text, not as an element. Do not add `rehype-raw`.

- [ ] **Step 1: Install the dependencies**

Run: `npm install react-markdown remark-gfm`
Expected: both appear under `dependencies` in `package.json`. They are runtime dependencies, not dev dependencies, because they render on the server during SSR.

- [ ] **Step 2: Write the failing test**

Create `src/test/markdown.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "#/components/markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders nothing for empty input", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
    const { container: c2 } = render(<Markdown>{null}</Markdown>);
    expect(c2.textContent).toBe("");
  });

  it("renders a bullet list", () => {
    const { container } = render(
      <Markdown>{"- ingests sensor data\n- stores it in Postgres"}</Markdown>
    );
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("ingests sensor data");
  });

  it("renders emphasis", () => {
    const { container } = render(<Markdown>{"a **telemetry** run"}</Markdown>);
    expect(container.querySelector("strong")?.textContent).toBe("telemetry");
  });

  it("renders links with a safe rel and target", () => {
    const { container } = render(
      <Markdown>{"see [the docs](https://example.com/x)"}</Markdown>
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/x");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });

  it("clamps every heading level to h4", () => {
    const { container } = render(<Markdown>{"# Top\n\n### Third"}</Markdown>);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("h3")).toBeNull();
    expect(container.querySelectorAll("h4").length).toBe(2);
  });

  it("does not execute or emit raw HTML", () => {
    const { container } = render(
      <Markdown>{"<script>alert(1)</script><b>raw</b>"}</Markdown>
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("alert(1)");
  });

  it("does not render images", () => {
    const { container } = render(
      <Markdown>{"![a rover](https://example.com/r.png)"}</Markdown>
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders a GFM table", () => {
    const { container } = render(
      <Markdown>{"| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>
    );
    expect(container.querySelector("table")).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/test/markdown.test.tsx`
Expected: FAIL, cannot resolve `#/components/markdown`.

- [ ] **Step 4: Write the component**

Create `src/components/markdown.tsx`:

```tsx
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * The single markdown render path for project content.
 *
 * Renders React elements, never an HTML string, so no `dangerouslySetInnerHTML`
 * and no sanitizer are involved. Raw HTML in the source is inert because
 * `rehype-raw` is deliberately not installed.
 *
 * All six heading levels are allowed and then mapped to `h4`: `allowedElements`
 * filters by tag name before `components` runs, so a level that is not allowed
 * would be unwrapped rather than remapped.
 */
const ALLOWED_ELEMENTS = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "a",
  "code",
  "pre",
  "blockquote",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

function Heading({ children }: { children?: ReactNode }) {
  return <h4 className="font-medium text-base">{children}</h4>;
}

function Anchor({ href, children }: { children?: ReactNode; href?: string }) {
  return (
    <a href={href} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  );
}

const COMPONENTS = {
  a: Anchor,
  h1: Heading,
  h2: Heading,
  h3: Heading,
  h4: Heading,
  h5: Heading,
  h6: Heading,
};

export function Markdown({
  children,
}: {
  children: string | null | undefined;
}) {
  if (!children?.trim()) {
    return null;
  }
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown
        allowedElements={ALLOWED_ELEMENTS}
        components={COMPONENTS}
        remarkPlugins={[remarkGfm]}
        unwrapDisallowed
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/test/markdown.test.tsx`
Expected: PASS, 8 tests.

If the raw-HTML test fails because `<b>raw</b>` renders as an element, `rehype-raw` has been pulled in somewhere. Remove it; that test is the security boundary for this component.

- [ ] **Step 6: Lint and commit**

```bash
npm run check
git add package.json package-lock.json src/components/markdown.tsx src/test/markdown.test.tsx
git commit -m "feat: add a Markdown render component with a safe element allowlist"
```

---

## Task 3: Render the project detail sections as markdown

**Files:**

- Modify: `src/routes/projects/$projectId.tsx:232-242`

**Interfaces:**

- Consumes: `Markdown` from Task 2.
- Produces: nothing new.

**Context:** `Section` is the shared renderer for the description, problem statement, objectives, both qualification fields, and license restrictions on the public detail page. It currently renders `<p className="mt-1 whitespace-pre-wrap">{body}</p>`.

This is where the spec's accepted regression becomes visible: without `remark-breaks`, single newlines in existing content stop being line breaks and reflow into paragraphs. That is intended. Do not add `remark-breaks` to "fix" it.

- [ ] **Step 1: Swap the renderer**

In `src/routes/projects/$projectId.tsx`, add the import:

```tsx
import { Markdown } from "#/components/markdown";
```

and replace:

```tsx
function Section({ label, body }: { label: string; body: string | null }) {
  if (!body) {
    return null;
  }
  return (
    <section className="mt-6">
      <h2 className="font-medium text-muted-foreground text-sm">{label}</h2>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
    </section>
  );
}
```

with:

```tsx
function Section({ label, body }: { label: string; body: string | null }) {
  if (!body) {
    return null;
  }
  return (
    <section className="mt-6">
      <h2 className="font-medium text-muted-foreground text-sm">{label}</h2>
      <div className="mt-1">
        <Markdown>{body}</Markdown>
      </div>
    </section>
  );
}
```

The `<p>` becomes a `<div>` because `Markdown` emits block elements, and a `<p>` cannot legally contain a `<ul>` or another `<p>`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev` and open a published project that has a description. Confirm:

- Existing plain text still renders and reads correctly.
- A field manually edited to contain `- one\n- two` renders as a real bullet list.
- A field containing `# Title` renders it at `h4` size, and the page's `h1` is still the project title.

- [ ] **Step 4: Run the accessibility suite**

Run: `npm run test:accessibility`
Expected: PASS. This is the check that heading order was not broken by author content.

- [ ] **Step 5: Lint and commit**

```bash
npm run check
git add src/routes/projects/\$projectId.tsx
git commit -m "feat: render project detail sections as markdown"
```

---

## Task 4: The toolbar edit calculator

**Files:**

- Create: `src/lib/markdown-toolbar.ts`
- Create: `src/lib/__tests__/markdown-toolbar.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export type ToolbarAction = "bold" | "italic" | "bulletList" | "numberedList" | "link";

  export interface EditorState {
    selectionEnd: number;
    selectionStart: number;
    value: string;
  }

  export interface ToolbarEdit {
    rangeEnd: number;
    rangeStart: number;
    replacement: string;
    selectionEnd: number;
    selectionStart: number;
  }

  export function buildToolbarEdit(state: EditorState, action: ToolbarAction): ToolbarEdit;
  export function applyEdit(value: string, edit: ToolbarEdit): string;
  ```

  Task 5 calls `buildToolbarEdit` and `applyEdit` with exactly these shapes.

**Context:** This is deliberately a **range replacement**, not a whole-new-value calculation. The component feeds `replacement` to `document.execCommand("insertText")` over `[rangeStart, rangeEnd]`, which is what preserves the browser's native undo stack. A whole-value swap would clear undo history on every toolbar click.

Keeping it pure and DOM-free is what makes the tricky selection arithmetic testable without jsdom.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/markdown-toolbar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  applyEdit,
  buildToolbarEdit,
  type EditorState,
} from "#/lib/markdown-toolbar";

function state(value: string, start: number, end = start): EditorState {
  return { value, selectionStart: start, selectionEnd: end };
}

describe("buildToolbarEdit: bold", () => {
  it("wraps the selection and keeps it selected", () => {
    const edit = buildToolbarEdit(state("the rover", 4, 9), "bold");
    expect(applyEdit("the rover", edit)).toBe("the **rover**");
    expect(edit.selectionStart).toBe(6);
    expect(edit.selectionEnd).toBe(11);
  });

  it("inserts a selected placeholder when nothing is selected", () => {
    const edit = buildToolbarEdit(state("", 0), "bold");
    const next = applyEdit("", edit);
    expect(next).toBe("**bold text**");
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      "bold text"
    );
  });
});

describe("buildToolbarEdit: italic", () => {
  it("wraps with single asterisks", () => {
    const edit = buildToolbarEdit(state("a word here", 2, 6), "italic");
    expect(applyEdit("a word here", edit)).toBe("a *word* here");
    expect(edit.selectionStart).toBe(3);
    expect(edit.selectionEnd).toBe(7);
  });
});

describe("buildToolbarEdit: link", () => {
  it("selects the url placeholder when text was selected", () => {
    const edit = buildToolbarEdit(state("docs", 0, 4), "link");
    const next = applyEdit("docs", edit);
    expect(next).toBe("[docs](https://)");
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe("https://");
  });

  it("selects the text placeholder when nothing was selected", () => {
    const edit = buildToolbarEdit(state("", 0), "link");
    const next = applyEdit("", edit);
    expect(next).toBe("[link text](https://)");
    expect(next.slice(edit.selectionStart, edit.selectionEnd)).toBe(
      "link text"
    );
  });
});

describe("buildToolbarEdit: lists", () => {
  it("prefixes every selected line with a bullet", () => {
    const edit = buildToolbarEdit(state("a\nb", 0, 3), "bulletList");
    expect(applyEdit("a\nb", edit)).toBe("- a\n- b");
  });

  it("numbers every selected line in order", () => {
    const edit = buildToolbarEdit(state("a\nb\nc", 0, 5), "numberedList");
    expect(applyEdit("a\nb\nc", edit)).toBe("1. a\n2. b\n3. c");
  });

  it("prefixes only the caret's line when nothing is selected", () => {
    const value = "first\nsecond\nthird";
    const edit = buildToolbarEdit(state(value, 8), "bulletList");
    expect(applyEdit(value, edit)).toBe("first\n- second\nthird");
  });

  it("leaves surrounding lines untouched", () => {
    const value = "keep\na\nb\nkeep";
    const edit = buildToolbarEdit(state(value, 5, 8), "bulletList");
    expect(applyEdit(value, edit)).toBe("keep\n- a\n- b\nkeep");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/markdown-toolbar.test.ts`
Expected: FAIL, cannot resolve `#/lib/markdown-toolbar`.

- [ ] **Step 3: Write the calculator**

Create `src/lib/markdown-toolbar.ts`:

```ts
/**
 * Pure selection arithmetic for the markdown editor toolbar.
 *
 * Returns a *range replacement* rather than a whole new value, because the
 * component applies it through `document.execCommand("insertText")`, which
 * preserves the browser's native undo stack. Replacing the entire textarea
 * value would discard undo history on every toolbar click.
 */
export type ToolbarAction =
  | "bold"
  | "italic"
  | "bulletList"
  | "numberedList"
  | "link";

export interface EditorState {
  selectionEnd: number;
  selectionStart: number;
  value: string;
}

export interface ToolbarEdit {
  rangeEnd: number;
  rangeStart: number;
  replacement: string;
  selectionEnd: number;
  selectionStart: number;
}

const WRAPPERS = {
  bold: { marker: "**", placeholder: "bold text" },
  italic: { marker: "*", placeholder: "italic text" },
} as const;

const LINK_TEXT_PLACEHOLDER = "link text";
const LINK_URL_PLACEHOLDER = "https://";
const LINK_PREFIX_LENGTH = 3; // "[" + text + "]("

export function applyEdit(value: string, edit: ToolbarEdit): string {
  return (
    value.slice(0, edit.rangeStart) +
    edit.replacement +
    value.slice(edit.rangeEnd)
  );
}

function wrapEdit(state: EditorState, action: "bold" | "italic"): ToolbarEdit {
  const { marker, placeholder } = WRAPPERS[action];
  const selected = state.value.slice(state.selectionStart, state.selectionEnd);
  const text = selected || placeholder;
  return {
    rangeStart: state.selectionStart,
    rangeEnd: state.selectionEnd,
    replacement: `${marker}${text}${marker}`,
    selectionStart: state.selectionStart + marker.length,
    selectionEnd: state.selectionStart + marker.length + text.length,
  };
}

function linkEdit(state: EditorState): ToolbarEdit {
  const selected = state.value.slice(state.selectionStart, state.selectionEnd);
  const text = selected || LINK_TEXT_PLACEHOLDER;
  const urlStart = state.selectionStart + text.length + LINK_PREFIX_LENGTH;
  const selectsUrl = selected.length > 0;
  return {
    rangeStart: state.selectionStart,
    rangeEnd: state.selectionEnd,
    replacement: `[${text}](${LINK_URL_PLACEHOLDER})`,
    selectionStart: selectsUrl ? urlStart : state.selectionStart + 1,
    selectionEnd: selectsUrl
      ? urlStart + LINK_URL_PLACEHOLDER.length
      : state.selectionStart + 1 + text.length,
  };
}

function listEdit(
  state: EditorState,
  action: "bulletList" | "numberedList"
): ToolbarEdit {
  const lineStart = state.value.lastIndexOf("\n", state.selectionStart - 1) + 1;
  const nextNewline = state.value.indexOf("\n", state.selectionEnd);
  const lineEnd = nextNewline === -1 ? state.value.length : nextNewline;
  const lines = state.value.slice(lineStart, lineEnd).split("\n");
  const replacement = lines
    .map((line, index) =>
      action === "bulletList" ? `- ${line}` : `${index + 1}. ${line}`
    )
    .join("\n");
  return {
    rangeStart: lineStart,
    rangeEnd: lineEnd,
    replacement,
    selectionStart: lineStart,
    selectionEnd: lineStart + replacement.length,
  };
}

export function buildToolbarEdit(
  state: EditorState,
  action: ToolbarAction
): ToolbarEdit {
  if (action === "bold" || action === "italic") {
    return wrapEdit(state, action);
  }
  if (action === "link") {
    return linkEdit(state);
  }
  return listEdit(state, action);
}
```

`lastIndexOf("\n", -1)` returns `-1`, so `lineStart` is `0` when the caret is at the very start. That is the behaviour the "prefixes only the caret's line" test pins down.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/markdown-toolbar.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run check
git add src/lib/markdown-toolbar.ts src/lib/__tests__/markdown-toolbar.test.ts
git commit -m "feat: add pure toolbar edit calculator for the markdown editor"
```

---

## Task 5: The `MarkdownField` editor and its form wiring

**Files:**

- Create: `src/components/markdown-field.tsx`
- Create: `src/test/markdown-field.test.tsx`
- Modify: `src/components/project-form.tsx`

**Interfaces:**

- Consumes: `buildToolbarEdit`, `applyEdit`, `ToolbarAction`, `EditorState` (Task 4); `Markdown` (Task 2).
- Produces:

  ```ts
  export function MarkdownField(props: {
    id: string;
    name: string;
    onBlur: () => void;
    onChange: (value: string) => void;
    placeholder?: string;
    rows?: number;
    value: string;
  }): JSX.Element
  ```

**Context:** `project-form.tsx` renders every field through one shared `Field` component that branches on a `textarea` prop. Six fields pass `textarea`, and so does `notes` (line 371-379), which must stay a plain textarea. So the switch is a **new `markdown` prop**, not a reinterpretation of `textarea`.

`Field` currently branches inline with a ternary. Adding a third branch would create a nested ternary, which the project's standards call out explicitly. Extract a `FieldControl` component instead.

- [ ] **Step 1: Write the failing test**

Create `src/test/markdown-field.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownField } from "#/components/markdown-field";

afterEach(cleanup);

function setup(value = "", onChange = vi.fn()) {
  render(
    <MarkdownField
      id="description"
      name="description"
      onBlur={() => {
        // no-op
      }}
      onChange={onChange}
      value={value}
    />
  );
  return { onChange };
}

describe("MarkdownField", () => {
  it("renders a textarea holding the raw markdown source", () => {
    setup("- one\n- two");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("- one\n- two");
  });

  it("labels every toolbar button", () => {
    setup();
    for (const name of [
      "Bold",
      "Italic",
      "Bullet list",
      "Numbered list",
      "Link",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("applies a toolbar action to the selection", () => {
    const { onChange } = setup("the rover");
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(4, 9);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenCalledWith("the **rover**");
  });

  it("switches to a rendered preview and back", () => {
    setup("- one\n- two");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelectorAll("li").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("tells the author that markdown is supported", () => {
    setup();
    expect(document.body.textContent).toContain("Markdown supported");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/test/markdown-field.test.tsx`
Expected: FAIL, cannot resolve `#/components/markdown-field`.

- [ ] **Step 3: Write the component**

Create `src/components/markdown-field.tsx`:

```tsx
import { Bold, Italic, Link2, List, ListOrdered } from "lucide-react";
import { useRef, useState } from "react";
import {
  applyEdit,
  buildToolbarEdit,
  type ToolbarAction,
} from "#/lib/markdown-toolbar";
import { Markdown } from "./markdown";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

interface Props {
  id: string;
  name: string;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  value: string;
}

const ACTIONS: { action: ToolbarAction; icon: typeof Bold; label: string }[] = [
  { action: "bold", icon: Bold, label: "Bold" },
  { action: "italic", icon: Italic, label: "Italic" },
  { action: "bulletList", icon: List, label: "Bullet list" },
  { action: "numberedList", icon: ListOrdered, label: "Numbered list" },
  { action: "link", icon: Link2, label: "Link" },
];

export function MarkdownField({
  id,
  name,
  onBlur,
  onChange,
  placeholder,
  rows,
  value,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  function runAction(action: ToolbarAction) {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    const edit = buildToolbarEdit(
      {
        value: el.value,
        selectionStart: el.selectionStart,
        selectionEnd: el.selectionEnd,
      },
      action
    );
    el.focus();
    el.setSelectionRange(edit.rangeStart, edit.rangeEnd);
    // execCommand is deprecated but is the only API that keeps the browser's
    // native undo stack intact. setRangeText is the fallback where it is
    // missing (including jsdom), at the cost of undo granularity.
    const usedExecCommand =
      typeof document.execCommand === "function" &&
      document.execCommand("insertText", false, edit.replacement);
    if (!usedExecCommand) {
      el.value = applyEdit(el.value, edit);
    }
    el.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    onChange(el.value);
  }

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-input border-b-0 p-1">
        {ACTIONS.map(({ action, icon: Icon, label }) => (
          <Button
            aria-label={label}
            disabled={mode === "preview"}
            key={action}
            onClick={() => runAction(action)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden className="size-4" />
          </Button>
        ))}
        <div className="ml-auto flex gap-1">
          <Button
            onClick={() => setMode("edit")}
            size="sm"
            type="button"
            variant={mode === "edit" ? "secondary" : "ghost"}
          >
            Edit
          </Button>
          <Button
            onClick={() => setMode("preview")}
            size="sm"
            type="button"
            variant={mode === "preview" ? "secondary" : "ghost"}
          >
            Preview
          </Button>
        </div>
      </div>
      {mode === "edit" ? (
        <Textarea
          className="rounded-t-none"
          id={id}
          name={name}
          onBlur={onBlur}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          ref={textareaRef}
          rows={rows}
          value={value}
        />
      ) : (
        <div className="min-h-24 rounded-b-md border border-input p-3">
          <Markdown>{value}</Markdown>
        </div>
      )}
      <p className="mt-1 text-muted-foreground text-xs">
        Markdown supported: **bold**, *italic*, - bullet lists, [links](url).
      </p>
    </div>
  );
}
```

`ref` is passed as a plain prop, not through `forwardRef`, per the project's React 19 standard.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/test/markdown-field.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Extract `FieldControl` in the project form**

In `src/components/project-form.tsx`, add to the `FieldProps` interface, next to the existing `textarea?: boolean;`:

```tsx
  markdown?: boolean;
```

Add the import:

```tsx
import { MarkdownField } from "./markdown-field";
```

Then replace the ternary inside `Field`:

```tsx
{
  textarea ? (
    <Textarea
      className="mt-1"
      id={field.name}
      name={field.name}
      onBlur={field.handleBlur}
      onChange={(e) => field.handleChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      value={field.state.value as string}
    />
  ) : (
    <Input
      className="mt-1"
      id={field.name}
      name={field.name}
      onBlur={field.handleBlur}
      onChange={(e) => field.handleChange(e.target.value)}
      placeholder={placeholder}
      value={field.state.value as string}
    />
  );
}
```

with a single call:

```tsx
<FieldControl
  field={field}
  markdown={markdown}
  placeholder={placeholder}
  rows={rows}
  textarea={textarea}
/>;
```

and add this component above `Field` in the same file:

```tsx
function FieldControl({
  field,
  markdown,
  placeholder,
  rows,
  textarea,
}: {
  field: AnyForm;
  markdown?: boolean;
  placeholder?: string;
  rows?: number;
  textarea?: boolean;
}) {
  if (markdown) {
    return (
      <MarkdownField
        id={field.name}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(value: string) => field.handleChange(value)}
        placeholder={placeholder}
        rows={rows}
        value={field.state.value as string}
      />
    );
  }
  if (textarea) {
    return (
      <Textarea
        className="mt-1"
        id={field.name}
        name={field.name}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        value={field.state.value as string}
      />
    );
  }
  return (
    <Input
      className="mt-1"
      id={field.name}
      name={field.name}
      onBlur={field.handleBlur}
      onChange={(e) => field.handleChange(e.target.value)}
      placeholder={placeholder}
      value={field.state.value as string}
    />
  );
}
```

Remember to destructure `markdown` in `Field`'s parameter list alongside `textarea`.

- [ ] **Step 6: Switch the six fields to markdown mode**

In the same file, change the `textarea` prop to `markdown` on exactly these six `Field` call sites: `description`, `problemStatement`, `objectives`, `minQualifications`, `prefQualifications`, `licenseRestrictions`.

For example, `description` becomes:

```tsx
<Field
  form={form}
  label="Description"
  markdown
  name="description"
  onApply={() => applyField("description")}
  rows={4}
  suggestion={suggestions.description}
/>;
```

**Leave `notes` (line 371-379) on `textarea`.** Internal staff notes are explicitly out of scope, and it is the one remaining `textarea` consumer.

- [ ] **Step 7: Run the full unit suite**

Run: `npm run test`
Expected: PASS. `src/test/project-form-ai-review.test.tsx` exercises this form; if it queries a textarea by role for one of the six fields, it still works, because `MarkdownField` renders a real `Textarea` in edit mode.

- [ ] **Step 8: Manual verification**

Run `npm run dev` and open `/projects/new`:

- Select a word in Description and click Bold. The word is wrapped and stays selected.
- Click Bold with no selection. `**bold text**` is inserted with the placeholder selected.
- Select two lines and click Bullet list. Both lines get `- `.
- Press Ctrl/Cmd+Z after a toolbar click. The edit is undone in one step.
- Click Preview. The list renders. Click Edit. The source returns.
- Save and reopen the project. The markdown source round-trips unchanged.

- [ ] **Step 9: Lint and commit**

```bash
npm run check
git add src/components/markdown-field.tsx src/test/markdown-field.test.tsx src/components/project-form.tsx
git commit -m "feat: add a markdown editor with toolbar and preview to project fields"
```

---

## Task 6: Teach the AI reviewer that fields are markdown

**Files:**

- Modify: `src/server/_internal/project-review-core.ts:57` (the `SYSTEM_PROMPT` rule list)
- Modify: `src/server/__tests__/project-review-core.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: nothing. This is the last task.

**Context:** The Bedrock review path reads the same six columns and returns replacement text that the author applies straight back into the field. If the model returns prose where the author had a bullet list, applying a suggestion silently destroys their formatting. `SYSTEM_PROMPT` is exported and already covered by `project-review-core.test.ts`, so this is a testable change rather than an untested prompt tweak.

- [ ] **Step 1: Write the failing test**

Add to `src/server/__tests__/project-review-core.test.ts`:

```ts
import { SYSTEM_PROMPT } from "../_internal/project-review-core";

describe("SYSTEM_PROMPT", () => {
  it("tells the model that field content is markdown", () => {
    expect(SYSTEM_PROMPT).toContain("Markdown");
  });

  it("tells the model to return markdown and preserve structure", () => {
    expect(SYSTEM_PROMPT).toContain("Return each suggestion as Markdown");
  });
});
```

Merge the `SYSTEM_PROMPT` import into the existing import block from `../_internal/project-review-core` rather than adding a second import statement.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/__tests__/project-review-core.test.ts`
Expected: FAIL on both new assertions. The current prompt never mentions markdown.

- [ ] **Step 3: Add the rule to the prompt**

In `src/server/_internal/project-review-core.ts`, inside `SYSTEM_PROMPT`, add one bullet to the existing rule list, immediately after the "Keep the same language and a professional, neutral tone." line:

```
- Field content is Markdown. Return each suggestion as Markdown, preserving any structure the author used (bullet lists, emphasis, links) and using bullet lists where a field is naturally a list, such as qualifications or objectives.
```

Leave every other line of the prompt unchanged, including the untrusted-content instruction, which is a security boundary.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/__tests__/project-review-core.test.ts`
Expected: PASS, including the pre-existing tests in that file.

- [ ] **Step 5: Manual verification**

With `BEDROCK_MODEL_ID` configured, open a project with a prose-style qualifications field and request AI suggestions. The returned suggestion for a list-shaped field should come back as a markdown bullet list, and applying it should render as a list on the detail page.

If Bedrock is not configured locally, skip this step and note it; the unit test covers the prompt content itself.

- [ ] **Step 6: Lint and commit**

```bash
npm run check
git add src/server/_internal/project-review-core.ts src/server/__tests__/project-review-core.test.ts
git commit -m "feat: tell the AI reviewer that project fields are markdown"
```

---

## Self-Review

**Spec coverage:**

| Spec section                                                     | Task                                                 |
| ---------------------------------------------------------------- | ---------------------------------------------------- |
| Markdown source stored in existing columns, no migration         | Implicit throughout; no task touches `src/db`        |
| `react-markdown` + `remark-gfm`, no `dangerouslySetInnerHTML`    | Task 2                                               |
| No `remark-breaks`; reflow accepted                              | Task 2 (absent from plugin list), Task 3 Step 1 note |
| Headings clamped to `h4`                                         | Task 2, Steps 2 and 4                                |
| Links get `rel="noopener noreferrer"`                            | Task 2, Steps 2 and 4                                |
| Raw HTML inert, no images                                        | Task 2, Step 2                                       |
| Six fields in scope, `title` and `notes` excluded                | Task 5, Step 6                                       |
| `MarkdownField`: toolbar, preview tab, undo-preserving insertion | Tasks 4 and 5                                        |
| `stripMarkdown` for card and row summaries                       | Task 1                                               |
| Detail page `Section` renders markdown                           | Task 3                                               |
| AI review prompt updated                                         | Task 6                                               |
| `search_vector` untouched                                        | No task modifies `src/db/schema.ts`                  |
| Testing: toolbar helper over empty/single/multi-line selection   | Task 4, Step 1                                       |
| Testing: `stripMarkdown` over all syntax forms                   | Task 1, Step 1                                       |
| Testing: renderer safe subset, no script or img                  | Task 2, Step 2                                       |
| Testing: `#` renders as `h4`                                     | Task 2, Step 2                                       |
| Accessibility: heading order preserved                           | Task 3, Step 4                                       |

**Type consistency:** `stripMarkdown(input: string | null | undefined): string` is defined in Task 1 and called in Task 1 only. `Markdown({ children })` is defined in Task 2 and consumed in Task 3 and Task 5 with a `string` child. `buildToolbarEdit(state, action)` and `applyEdit(value, edit)` are defined in Task 4 and called in Task 5 with `EditorState` built from live textarea properties. `MarkdownField`'s `onChange: (value: string) => void` differs from `Textarea`'s event-based `onChange`, which is why `FieldControl` adapts it with `(value: string) => field.handleChange(value)` in Task 5, Step 5.

**Placeholder scan:** none. Every code step shows complete code, and every command states its expected result.

**Ordering note:** Task 1 ships before any markdown can be authored, so listings are never exposed to raw syntax. Task 3 (detail rendering) intentionally precedes Task 5 (authoring), because rendering existing plain text is safe while authoring markdown into an unrendered field would not be.
