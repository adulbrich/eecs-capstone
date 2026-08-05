import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";

interface Props {
  /** Base filename, no extension. The current date is appended. */
  filename: string;
  /** Produces the CSV text. Async so it can call a server function. */
  load: () => Promise<string>;
}

/**
 * UTF-8 byte order mark. Without it Excel reads the file in the system
 * codepage and renders accented names as mojibake.
 */
const BOM = "\uFEFF";

/** Shown when a rejection carries no usable message of its own. */
const DEFAULT_ERROR_MESSAGE = "Export failed. Try again.";

/**
 * `load()` can reject with anything, not just an `Error`: a string, a plain
 * object, a Response-shaped failure from a future server function. An
 * unconditional `(err as Error).message` reads as `undefined` for all of
 * those, and `{error && ...}` then renders nothing at all, so the export
 * silently no-ops for the user. Every branch here returns a non-empty
 * string.
 */
function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === "string" && err) {
    return err;
  }
  return DEFAULT_ERROR_MESSAGE;
}

export function ExportCsvButton({ filename, load }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  async function runExport() {
    setPending(true);
    setError(null);
    setAnnouncement("");
    try {
      const csv = await load();
      const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
      // Appended before the click, not just constructed: Firefox can decline
      // to start a download from an anchor that was never in the document.
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Deferred, not synchronous: revoking the object URL in the same tick
      // as the click has been observed to race the download in Firefox,
      // which can end up reading a URL that already points nowhere. A
      // macrotask is enough to run after the browser has queued the
      // download, while still guaranteeing the URL is released rather than
      // leaked.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setAnnouncement(`${filename} exported.`);
    } catch (err) {
      // Rendered inline rather than thrown: a failed export must not blank
      // the table it sits above. Also announced through the live region,
      // the same way success is, so a screen reader user learns the export
      // failed instead of hearing nothing at all.
      const message = errorMessage(err);
      setError(message);
      setAnnouncement(`${filename} export failed: ${message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {/*
        Default size, not sm: this sits beside the Columns button and the
        page's filter controls, which are all h-9.
      */}
      <Button
        aria-busy={pending}
        disabled={pending}
        onClick={runExport}
        variant="outline"
      >
        <Download aria-hidden className="size-4" />
        {pending ? "Exporting…" : "Export CSV"}
      </Button>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
