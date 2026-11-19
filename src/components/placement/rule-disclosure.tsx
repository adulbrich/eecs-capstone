import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { Button } from "#/components/ui/button";
import { cn } from "#/lib/utils";

/**
 * A rule the page explains (#739): the one sentence a reader needs at the
 * control, always in view, and the rest under a disclosure drawn as the
 * page's others are, a ghost button with a leading chevron. Closed, the rest
 * carries `hidden`: out of the accessibility tree and find-in-page, still
 * mounted.
 */
export function RuleDisclosure({
  children,
  className,
  label,
  muted = true,
  summary,
}: {
  /** The rest of the rule, word for word where it still reads. */
  children: ReactNode;
  className?: string;
  /** The disclosure's name: "How the board works". */
  label: string;
  /** Help-text grey; false inside a panel whose sentences are body text. */
  muted?: boolean;
  /** The sentence that explains the surprise or the side effect. */
  summary: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronDown : ChevronRight;
  const tone = muted ? "text-muted-foreground" : undefined;
  return (
    <div className={cn("text-sm", className)}>
      <p className={tone}>{summary}</p>
      <Button
        aria-controls={id}
        aria-expanded={open}
        className="mt-1"
        onClick={() => setOpen(!open)}
        size="bare"
        type="button"
        variant="ghost"
      >
        <Chevron aria-hidden="true" />
        {label}
      </Button>
      <div className={cn("mt-1 max-w-prose pl-5", tone)} hidden={!open} id={id}>
        {children}
      </div>
    </div>
  );
}

const FIRST_SENTENCE = /^([\s\S]+?[.!?])\s+(\S[\s\S]*)$/u;

/**
 * A plain-prose description cut after its first sentence, for a summary and
 * the rest; the rest is empty when there is one sentence.
 */
export function splitFirstSentence(text: string): {
  rest: string;
  summary: string;
} {
  const match = FIRST_SENTENCE.exec(text.trim());
  return match
    ? { rest: match[2], summary: match[1] }
    : { rest: "", summary: text.trim() };
}
