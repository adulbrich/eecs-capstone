import { useEffect, useState } from "react";
import { formatOfficeDay } from "#/lib/day-range";

/**
 * Renders a timestamp without tripping hydration.
 *
 * `toLocaleString()` formats in the *runtime's* timezone and locale, so the
 * server (UTC in a container) and the browser (the reader's zone) produce
 * different text for the same instant. React compares the two and reports a
 * hydration mismatch, then throws away and re-renders the tree.
 *
 * So the first client render must match the server byte for byte: both emit a
 * fixed UTC rendering. The switch to the reader's own locale happens in an
 * effect, which only ever runs on the client and therefore cannot disagree
 * with anything the server sent.
 */
function isoOf(value: Date | string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function utcText(iso: string, dateOnly: boolean): string {
  return dateOnly
    ? iso.slice(0, 10)
    : `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * A deadline staff picked as a day, such as a due date, rendered as that day
 * in the office's zone. The server and the browser format it alike, so it
 * needs no effect, and the reader's zone does not move it: the end of the
 * 25th in Corvallis is the 26th in UTC and in New York (#805).
 */
export function OfficeDate({
  value,
}: {
  value: Date | string | null | undefined;
}) {
  const iso = value === null || value === undefined ? null : isoOf(value);
  if (!iso) {
    return null;
  }
  return <time dateTime={iso}>{formatOfficeDay(iso)}</time>;
}

export function LocalTime({
  dateOnly = false,
  value,
}: {
  dateOnly?: boolean;
  value: Date | string | null | undefined;
}) {
  const iso = value === null || value === undefined ? null : isoOf(value);
  // `iso` is a primitive, so the effect's dependency is stable even when the
  // caller passes a fresh Date object on every render.
  const [text, setText] = useState(() => (iso ? utcText(iso, dateOnly) : ""));

  useEffect(() => {
    if (!iso) {
      return;
    }
    const parsed = new Date(iso);
    setText(dateOnly ? parsed.toLocaleDateString() : parsed.toLocaleString());
  }, [iso, dateOnly]);

  if (!iso) {
    return null;
  }
  return <time dateTime={iso}>{text}</time>;
}
