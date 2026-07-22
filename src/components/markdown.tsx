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
 * All six heading levels are allowed and then mapped to `h3`: `allowedElements`
 * filters by tag name before `components` runs, so a level that is not allowed
 * would be unwrapped rather than remapped. `h3` is used because the routes
 * that render author markdown already run `h1` (page title) -> `h2` (section
 * label) -> author heading, and an `h4` there would skip `h3`, which is the
 * very heading-order violation this clamp exists to prevent.
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
  return <h3 className="font-semibold text-sm">{children}</h3>;
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
