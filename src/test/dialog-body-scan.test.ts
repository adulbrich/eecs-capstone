import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return full.endsWith(".tsx") ? [full] : [];
  });
}

const PAIRS = [
  { body: "<DialogBody", footer: "<DialogFooter" },
  { body: "<AlertDialogBody", footer: "<AlertDialogFooter" },
];

describe("dialog bodies", () => {
  it("are rendered by every file that renders a dialog footer", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      if (
        file.includes("src/components/ui/") ||
        file.includes("src/test/") ||
        file.includes(".test.")
      ) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      for (const { body, footer } of PAIRS) {
        // `<AlertDialogFooter` does not contain `<DialogFooter`, since the `<`
        // sits before `Alert`, so the two pairs are checked apart.
        if (source.includes(footer) && !source.includes(body)) {
          offenders.push(`${file}: renders ${footer}> without ${body}>`);
        }
      }
    }
    expect(
      offenders,
      "Anything between a dialog's header and footer goes in DialogBody or\n" +
        "AlertDialogBody, so a tall form scrolls with its header and buttons\n" +
        "still on screen (UI-CONVENTIONS, 'A tall dialog scrolls inside\n" +
        "itself').\n\n" +
        offenders.join("\n")
    ).toEqual([]);
  });
});
