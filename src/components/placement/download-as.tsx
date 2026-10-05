import { Download } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { ImportIssues } from "#/components/placement/import-issues";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { ImportIssue } from "#/lib/placement/csv";
import { downloadText } from "#/lib/placement/download";
import type { ExportDataset } from "#/lib/placement/formats";
import { exportPlugins, fromStandard } from "#/lib/placement/plugins";

const STANDARD = "standard";

/** The standard format's name in the Download as select. */
const STANDARD_LABELS: Record<ExportDataset, string> = {
  placement: "Placement CSV",
  bids: "Bids CSV",
};

/**
 * A download of what placement wrote (#734): the dataset's standard CSV, or
 * that CSV through an export plugin chosen in "Download as", with what the
 * plugin says the other tool does with the file. A dataset no export plugin
 * writes shows the button alone. The choice is kept in component state,
 * never in the workspace.
 */
export function DownloadAs({
  children,
  dataset,
  filename,
  text,
}: {
  /** The button's label. */
  children: ReactNode;
  dataset: ExportDataset;
  /** The standard CSV's file name. */
  filename: string;
  /** The standard CSV, built when the button is pressed. */
  text: () => string;
}) {
  const id = useId();
  const plugins = exportPlugins(dataset);
  const [chosen, setChosen] = useState(STANDARD);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const plugin = plugins.find((p) => p.id === chosen) ?? null;

  function download() {
    const file = fromStandard(plugin, text(), { filename });
    setIssues(file.issues);
    // A file the plugin could not write at all is not worth saving; the
    // problems below say why.
    if (!file.issues.some((i) => i.wholeFile)) {
      downloadText(file.filename, file.text, "text/csv");
    }
  }

  const button = (
    <Button onClick={download} size="sm" type="button" variant="outline">
      <Download aria-hidden="true" />
      {children}
    </Button>
  );
  if (plugins.length === 0) {
    return button;
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id}>Download as</Label>
        <Select
          onValueChange={(value) => {
            setChosen(value);
            setIssues([]);
          }}
          value={plugin?.id ?? STANDARD}
        >
          <SelectTrigger className="w-44" id={id} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={STANDARD}>{STANDARD_LABELS[dataset]}</SelectItem>
            {plugins.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {button}
      </div>
      {plugin !== null && (
        <p className="max-w-prose text-muted-foreground">
          {plugin.description}
        </p>
      )}
      <ImportIssues issues={issues} label={dataset} />
    </div>
  );
}
