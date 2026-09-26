import { Download } from "lucide-react";
import { Button } from "#/components/ui/button";
import { downloadText } from "#/lib/placement/download";
import { type CsvFormat, formatTemplate } from "#/lib/placement/formats";

/**
 * What a file must look like, beside the button that reads it: the header
 * row to copy, what each column means, and a template with invented rows.
 */
export function CsvFormatHelp({
  format,
  label,
}: {
  format: CsvFormat;
  label: string;
}) {
  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">
        Expected format for the {label} file
      </summary>
      <p className="mt-2 text-muted-foreground">
        A CSV with this header row. Column order does not matter, and header
        case is ignored.
      </p>
      <pre className="mt-2 overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs">
        {format.columns.map((c) => c.name).join(",")}
      </pre>
      <table className="mt-2 w-full text-left text-xs">
        <caption className="sr-only">Columns of the {label} file</caption>
        <thead>
          <tr className="text-muted-foreground">
            <th className="py-1 pr-2 font-medium" scope="col">
              Column
            </th>
            <th className="py-1 pr-2 font-medium" scope="col">
              Required
            </th>
            <th className="py-1 pr-2 font-medium" scope="col">
              Meaning
            </th>
            <th className="hidden py-1 font-medium sm:table-cell" scope="col">
              Example
            </th>
          </tr>
        </thead>
        <tbody>
          {format.columns.map((c) => (
            <tr className="border-t align-top" key={c.name}>
              <td className="py-1 pr-2 font-mono">{c.name}</td>
              <td className="py-1 pr-2">{c.required ? "Yes" : "No"}</td>
              <td className="py-1 pr-2">{c.meaning}</td>
              <td className="hidden py-1 sm:table-cell">{c.example || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {format.note && <p className="mt-2">{format.note}</p>}
      <Button
        className="mt-2"
        onClick={() =>
          downloadText(
            `${format.filename}.csv`,
            formatTemplate(format),
            "text/csv"
          )
        }
        size="sm"
        type="button"
        variant="outline"
      >
        <Download aria-hidden="true" />
        Download template
      </Button>
    </details>
  );
}
