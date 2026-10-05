/**
 * Saves text the page built as a file. Browser only. The anchor goes into
 * the document before the click and the URL is revoked a macrotask later,
 * for the Firefox reasons `ExportCsvButton` gives.
 */
export function downloadText(
  filename: string,
  text: string,
  type: "text/csv" | "application/json"
) {
  // Excel reads a CSV without a byte order mark in the system codepage.
  const body = type === "text/csv" ? `﻿${text}` : text;
  const url = URL.createObjectURL(
    new Blob([body], { type: `${type};charset=utf-8` })
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
