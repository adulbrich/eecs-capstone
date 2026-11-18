/**
 * Two versions of a text as a code editor shows the difference (#839): line
 * by line, unchanged lines as context, and inside a removed line followed by
 * an added one, the words that changed. The staff panel's edit log renders
 * this; pure, so the rules below are unit tests.
 *
 * The line and word diffs are jsdiff's (`diff`), Myers' algorithm, so a
 * 5,000-character field costs its edit distance, not the square of its
 * length.
 */

import { diffLines, diffWordsWithSpace } from "diff";

/** A run of one line's text, marked when it is what changed. */
export interface DiffSegment {
  changed: boolean;
  text: string;
}

export type DiffLine =
  | {
      kind: "context" | "removed" | "added";
      /** The old line's number for a removed line, the new one's otherwise. */
      number: number;
      segments: DiffSegment[];
    }
  | { count: number; kind: "skipped" };

/** Unchanged lines kept on each side of a change, as an editor keeps them. */
export const CONTEXT_LINES = 3;

/** A change's lines, without the empty string a final newline leaves. */
function linesOf(value: string): string[] {
  const lines = value.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

const SPACE = /\s/gu;

function visibleLength(text: string): number {
  return text.replace(SPACE, "").length;
}

/**
 * The words of a removed line and the added line it became, each side's
 * segments marked where they differ. Lines are paired by position, so two
 * that share less than half of the shorter one's text are not the same line
 * reworded but two different lines, and neither is marked: the line's own
 * colour already says it was removed or added.
 */
function wordSegments(
  before: string,
  after: string
): { added: DiffSegment[]; removed: DiffSegment[] } {
  const removed: DiffSegment[] = [];
  const added: DiffSegment[] = [];
  let common = 0;
  for (const part of diffWordsWithSpace(before, after)) {
    if (!(part.added || part.removed)) {
      common += visibleLength(part.value);
    }
    if (!part.added) {
      removed.push({ changed: part.removed, text: part.value });
    }
    if (!part.removed) {
      added.push({ changed: part.added, text: part.value });
    }
  }
  const shorter = Math.min(visibleLength(before), visibleLength(after));
  if (common * 2 < shorter || common === 0) {
    return {
      added: [{ changed: false, text: after }],
      removed: [{ changed: false, text: before }],
    };
  }
  return { added, removed };
}

type FullLine = Extract<DiffLine, { segments: DiffSegment[] }>;

/** Every line of both versions, in order, numbered, with words marked. */
function allLines(before: string, after: string): FullLine[] {
  const out: FullLine[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  let pendingRemoved: FullLine[] = [];
  // A final line with and without its newline is the same line, and a CRLF
  // pasted in from Windows is the LF it renders as.
  const changes = diffLines(before, after, {
    ignoreNewlineAtEof: true,
    stripTrailingCr: true,
  });
  for (const change of changes) {
    const lines = linesOf(change.value);
    if (change.removed) {
      pendingRemoved = [];
      for (const text of lines) {
        pendingRemoved.push({
          kind: "removed",
          number: oldNumber,
          segments: [{ changed: false, text }],
        });
        oldNumber++;
      }
      out.push(...pendingRemoved);
      continue;
    }
    if (change.added) {
      // Pair each added line with the removed line just before it, first to
      // first, so a reworded line shows its changed words on both sides.
      for (const [i, text] of lines.entries()) {
        const partner = pendingRemoved[i];
        let segments: DiffSegment[] = [{ changed: false, text }];
        if (partner) {
          const words = wordSegments(partner.segments[0]?.text ?? "", text);
          partner.segments = words.removed;
          segments = words.added;
        }
        out.push({ kind: "added", number: newNumber, segments });
        newNumber++;
      }
      pendingRemoved = [];
      continue;
    }
    pendingRemoved = [];
    for (const text of lines) {
      out.push({
        kind: "context",
        number: newNumber,
        segments: [{ changed: false, text }],
      });
      oldNumber++;
      newNumber++;
    }
  }
  return out;
}

/**
 * The diff of `before` and `after`, with runs of unchanged lines more than
 * `CONTEXT_LINES` away from any change folded into one `skipped` line. Equal
 * texts give no lines at all; an empty side gives only the other side's.
 */
export function diffText(before: string, after: string): DiffLine[] {
  const lines = allLines(before, after);
  const near = new Set<number>();
  lines.forEach((line, i) => {
    if (line.kind !== "context") {
      for (let j = i - CONTEXT_LINES; j <= i + CONTEXT_LINES; j++) {
        near.add(j);
      }
    }
  });
  if (!lines.some((line) => line.kind !== "context")) {
    return [];
  }
  const out: DiffLine[] = [];
  let folded: FullLine[] = [];
  // A fold of one line takes as much room as the line, so it shows the line.
  const flush = () => {
    if (folded.length === 1) {
      out.push(...folded);
    } else if (folded.length > 1) {
      out.push({ count: folded.length, kind: "skipped" });
    }
    folded = [];
  };
  lines.forEach((line, i) => {
    if (line.kind === "context" && !near.has(i)) {
      folded.push(line);
      return;
    }
    flush();
    out.push(line);
  });
  flush();
  return out;
}
