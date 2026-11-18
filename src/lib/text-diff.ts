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

/**
 * The words of a removed line and the added line it became, each side's
 * segments marked where they differ. A side whose every word changed is left
 * unmarked: the line's own colour already says so.
 */
function wordSegments(
  before: string,
  after: string
): { added: DiffSegment[]; removed: DiffSegment[] } {
  const removed: DiffSegment[] = [];
  const added: DiffSegment[] = [];
  for (const part of diffWordsWithSpace(before, after)) {
    if (!part.added) {
      removed.push({ changed: part.removed, text: part.value });
    }
    if (!part.removed) {
      added.push({ changed: part.added, text: part.value });
    }
  }
  const whole = (segments: DiffSegment[]) =>
    segments.every((s) => s.changed || s.text.trim() === "");
  return {
    added: whole(added) ? [{ changed: false, text: after }] : added,
    removed: whole(removed) ? [{ changed: false, text: before }] : removed,
  };
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
  const out: DiffLine[] = [];
  let skipped = 0;
  lines.forEach((line, i) => {
    if (line.kind === "context" && !near.has(i)) {
      skipped++;
      return;
    }
    if (skipped > 0) {
      out.push({ count: skipped, kind: "skipped" });
      skipped = 0;
    }
    out.push(line);
  });
  if (skipped > 0 && out.length > 0) {
    out.push({ count: skipped, kind: "skipped" });
  }
  return out;
}
