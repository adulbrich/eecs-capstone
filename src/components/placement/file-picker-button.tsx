import { Upload } from "lucide-react";
import { type ReactNode, useCallback, useRef } from "react";
import { Button } from "#/components/ui/button";

/**
 * A hidden file input, a function that opens it, and the chosen file's
 * text. The input is cleared after every pick, so choosing the same file
 * again after editing it still fires. `open` must run inside a click, which
 * a `ConfirmDialog` confirm button is, so a replace can confirm first.
 */
export function useFilePicker({
  accept,
  inputLabel,
  onText,
}: {
  accept: string;
  /** The hidden input's accessible name, which the browser tests target. */
  inputLabel: string;
  onText: (text: string, filename: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const open = useCallback(() => ref.current?.click(), []);
  const input = (
    <input
      accept={accept}
      aria-label={inputLabel}
      className="hidden"
      onChange={async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) {
          onText(await file.text(), file.name);
        }
      }}
      ref={ref}
      type="file"
    />
  );
  return { input, open };
}

export function FilePickerButton({
  children,
  ...options
}: Parameters<typeof useFilePicker>[0] & { children: ReactNode }) {
  const { input, open } = useFilePicker(options);
  return (
    <>
      <Button onClick={open} size="sm" type="button" variant="outline">
        <Upload aria-hidden="true" />
        {children}
      </Button>
      {input}
    </>
  );
}
