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
      anchor.click();
      URL.revokeObjectURL(url);
      setAnnouncement(`${filename} exported.`);
    } catch (err) {
      // Rendered inline rather than thrown: a failed export must not blank
      // the table it sits above.
      setError((err as Error).message);
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
