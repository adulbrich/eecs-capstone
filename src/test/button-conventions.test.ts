import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The parts of UI-CONVENTIONS "Buttons and links" a regex can see.
 *
 * Four rules, four scans. What they cannot see is said in the doc and left
 * there: whether a `sm` button belongs on a row with an `Input`, whether a
 * label is sentence case, whether a shared icon component carries its own
 * `h-4 w-4` (`BookmarkIcon` did, and no scan over a Button's own body would
 * have found it). A rule in a doc is remembered; this is the part that is
 * enforced, in the style of `no-native-modals.test.ts` and
 * `brand-link-scan.test.ts`.
 */

const SRC_DIR = join(process.cwd(), "src");
// Compared by full path, not by name, for the reason `brand-link-scan.ts`
// gives: a bare-name check would exempt any directory called `test` anywhere
// under `src/`, a production one included, and would do so silently.
const TEST_DIR = join(SRC_DIR, "test");
const UI_DIR = join(SRC_DIR, "components", "ui");

/**
 * Raw `<button>` elements that stay raw, each with the reason.
 *
 * `src/components/ui/` is exempt wholesale: that is where the primitives live,
 * and `Button` and `PaginationButton` are both a raw `<button>` by definition.
 */
const RAW_BUTTON_ALLOWED = new Map([
  [
    "src/components/admin-data-table.tsx",
    "the sort header: a whole `<th>` is the hit area, which no Button size fits",
  ],
  [
    "src/components/staff-project-panel.tsx",
    "the status pill strip: pills, not buttons, and the current one is not pressable",
  ],
  [
    "src/components/notification-bell.tsx",
    "the notification rows and Mark all read: two-line, full-width rows need the `h-auto` a Button may not carry. #392 left these for #410, which rewires this file's failure reporting",
  ],
]);

function* sourceFiles(dir: string, extensions: string[]): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== TEST_DIR && entry.name !== "__tests__") {
        yield* sourceFiles(path, extensions);
      }
    } else if (
      extensions.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.includes(".test.")
    ) {
      yield path;
    }
  }
}

function rel(path: string): string {
  return relative(process.cwd(), path);
}

/**
 * The opening tag of every `<Tag`, brace-aware.
 *
 * A line-by-line regex finds almost none of these: props are one per line, so
 * `className` is rarely on the same line as `<Button`. Counting braces is what
 * stops a `className={cn(a, b > c)}` from ending the tag early.
 */
function openingTags(
  source: string,
  tag: string
): { at: number; text: string }[] {
  const opener = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  return [...source.matchAll(opener)].map((match) => {
    let depth = 0;
    let i = match.index;
    for (; i < source.length; i++) {
      const char = source[i];
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
      } else if (char === ">" && depth === 0) {
        break;
      }
    }
    return { at: match.index, text: source.slice(match.index, i + 1) };
  });
}

/** The whole `<Button ...>...</Button>`, so its descendants can be scanned. */
function buttonElements(
  source: string
): { at: number; open: string; body: string }[] {
  return openingTags(source, "Button").map(({ at, text }) => {
    const openEnd = at + text.length;
    if (text.endsWith("/>")) {
      return { at, open: text, body: "" };
    }
    const close = source.indexOf("</Button>", openEnd);
    return {
      at,
      open: text,
      body: source.slice(openEnd, close === -1 ? source.length : close),
    };
  });
}

/**
 * Every string literal in a `className`, whether a bare string or a `cn()`
 * call. A `className={className}` passthrough contributes nothing, which is
 * right: what the parent passes is the parent's to answer for.
 */
function classTokens(openingTag: string): string[] {
  const match = /className=(?:"([^"]*)"|\{([\s\S]*?)\})/.exec(openingTag);
  const literal = match?.[1];
  const expression = match?.[2];
  const strings =
    literal === undefined
      ? [...(expression ?? "").matchAll(/["'`]([^"'`]*)["'`]/g)].map(
          (m) => m[1]
        )
      : [literal];
  return strings.flatMap((s) => s.split(/\s+/)).filter(Boolean);
}

/**
 * `hover:`, `dark:`, `sm:`, `!` and friends are not part of the utility.
 *
 * Every variant, not just the first: `^` with `/g` still only matches at
 * position 0 in JavaScript, so the first draft turned `dark:hover:bg-secondary`
 * into `hover:bg-secondary` and then found no `bg-` at the front of it. A
 * stacked-variant colour override sailed through every check.
 */
function utility(token: string): string {
  return token.replace(/^(?:[^:\s]*:)+/, "").replace(/^!/, "");
}

// `text-`, `border-`, `ring-`, `outline-` and `shadow-` are the prefixes that
// are not always a colour. Everything they can be instead is listed, so a new
// colour token is caught by default rather than by being added here.
//
// An arbitrary value is a colour unless it reads as a length: `text-[13px]` is
// a size, `text-[var(--brand)]` and `text-[#fff]` are not, and only the second
// kind restyles a Button.
// `[length:...]` says so outright, whatever it holds, which covers
// `text-[length:var(--x)]` and `text-[length:calc(1rem+2px)]`. Without the
// hint, only a bare number and unit counts.
const ARBITRARY_LENGTH = String.raw`\[(?:length:[^\]]+|[\d.]+(?:px|r?em|%|pt|ch|vw|vh))\]`;
const TEXT_NOT_COLOR = new RegExp(
  String.raw`^text-(?:xs|sm|base|lg|xl|\dxl|left|center|right|start|end|justify|balance|pretty|wrap|nowrap|ellipsis|clip|${ARBITRARY_LENGTH})`
);
// A side, a width, or both, plus the line styles. Everything else after
// `border-` is a colour. The side and the width combine, as `border-t-4`, which
// flattening this into one list of single tokens quietly broke.
const BORDER_NOT_COLOR =
  /^border(?:-[xytrbles])?(?:-(?:0|2|4|8|px))?$|^border-(?:solid|dashed|dotted|double|hidden|none)$/;
const SHADOW_NOT_COLOR = /^shadow-(?:2?xs|sm|md|lg|xl|2xl|none|inner)$/;
const OUTLINE_NOT_COLOR =
  /^outline-(?:none|hidden|offset-|solid|dashed|dotted|double|\d)/;
// Ring widths, offsets and insets. `ring-ring/50` is the colour case.
const RING_NOT_COLOR = new RegExp(
  `^ring-(?:0|1|2|4|8|inset|offset-(?:0|1|2|4|8)|${ARBITRARY_LENGTH})$`
);

function setsColor(token: string): boolean {
  const u = utility(token);
  // `from-`, `via-` and `to-` are gradient stops, which are colours too.
  if (
    /^(?:bg|ring|fill|stroke|decoration|outline|shadow|accent|caret|divide|from|via|to)-/.test(
      u
    )
  ) {
    return !(
      SHADOW_NOT_COLOR.test(u) ||
      OUTLINE_NOT_COLOR.test(u) ||
      RING_NOT_COLOR.test(u)
    );
  }
  if (u.startsWith("text-")) {
    return !TEXT_NOT_COLOR.test(u);
  }
  if (u.startsWith("border-") || u === "border") {
    return !BORDER_NOT_COLOR.test(u);
  }
  return false;
}

// `size-*` sets a height as well as a width, so it belongs here rather than
// escaping as a width, which the rule allows.
const SETS_HEIGHT = /^(?:(?:min-|max-)?h|size)-\S/;
const SETS_PADDING = /^p[xytrbles]?-\S/;
const SETS_RADIUS = /^rounded(?:$|-)/;

function restyles(token: string): string | null {
  const u = utility(token);
  if (setsColor(token)) {
    return "colour";
  }
  if (SETS_HEIGHT.test(u)) {
    return "height";
  }
  if (SETS_PADDING.test(u)) {
    return "padding";
  }
  if (SETS_RADIUS.test(u)) {
    return "radius";
  }
  return null;
}

/**
 * An icon size class that is wrong or redundant inside a Button.
 *
 * An `h-`/`w-` pair is always wrong: the base rule
 * `[&_svg:not([class*='size-'])]:size-4` stands down only for a class
 * containing `size-`, so `h-5 w-5` loses to it on specificity and renders 16px
 * while reading as 20. `size-3` and `size-4` are the two variant defaults, so
 * either one restates the variant. Any other `size-N` passes, because it is
 * the escape hatch UI-CONVENTIONS sanctions for an icon that genuinely needs a
 * different size, and banning it would leave the documented route unusable.
 *
 * The boundary is `[\w-]` rather than whitespace, because these sit inside a
 * quoted class string: the first class after the opening quote has no space
 * in front of it, which is how `size-4` hid from the first draft of this. It
 * also keeps `min-w-[1.25rem]` and `max-h-16` out, since their `w`/`h` is
 * preceded by a hyphen.
 */
const ICON_SIZE_CLASS =
  /(?<![\w-])(?:(?:h|w)-\d[\d.]*(?![\w-])|size-[34](?![\w.-]))/g;

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

describe("button conventions", () => {
  it("no Button className sets a colour, a height, a padding or a radius", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC_DIR, [".tsx"])) {
      const source = readFileSync(path, "utf8");
      for (const button of buttonElements(source)) {
        for (const token of classTokens(button.open)) {
          const what = restyles(token);
          if (what) {
            offenders.push(
              `${rel(path)}:${lineOf(source, button.at)}: ${token} sets a ${what}`
            );
          }
        }
      }
    }
    expect(
      offenders,
      "A Button's className positions it and does not restyle it\n" +
        '(UI-CONVENTIONS, "`className` on a Button never restyles it").\n\n' +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("no size class on an icon inside a Button", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC_DIR, [".tsx"])) {
      const source = readFileSync(path, "utf8");
      for (const button of buttonElements(source)) {
        for (const hit of button.body.matchAll(ICON_SIZE_CLASS)) {
          offenders.push(
            `${rel(path)}:${lineOf(source, button.at)}: ${hit[0]}`
          );
        }
      }
    }
    expect(
      offenders,
      "The size variant sets the icon size, so a size class inside a Button\n" +
        "either duplicates it or silently loses to it (UI-CONVENTIONS,\n" +
        '"Every interactive action uses `<Button>`").\n\n' +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("no raw <button> outside the primitives and the allow list", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC_DIR, [".tsx"])) {
      if (path.startsWith(UI_DIR)) {
        continue;
      }
      const file = rel(path);
      if (RAW_BUTTON_ALLOWED.has(file)) {
        continue;
      }
      const source = readFileSync(path, "utf8");
      for (const { at } of openingTags(source, "button")) {
        offenders.push(`${file}:${lineOf(source, at)}`);
      }
    }
    expect(
      offenders,
      "A raw <button> misses the focus ring, the disabled state and the\n" +
        'dark-mode variants Button carries (UI-CONVENTIONS, "Every interactive\n' +
        'action uses `<Button>`"). A deliberate one goes in RAW_BUTTON_ALLOWED\n' +
        "with its reason.\n\n" +
        offenders.join("\n")
    ).toEqual([]);

    // The other direction: an allow-listed file that no longer has a raw
    // button should lose its entry, so the list cannot grow stale.
    const stale = [...RAW_BUTTON_ALLOWED.keys()].filter(
      (file) =>
        !/<button[\s/>]/.test(readFileSync(join(process.cwd(), file), "utf8"))
    );
    expect(stale).toEqual([]);
  });

  it("no real ellipsis character anywhere in src", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC_DIR, [".ts", ".tsx"])) {
      const source = readFileSync(path, "utf8");
      source.split("\n").forEach((line, i) => {
        if (line.includes("…")) {
          offenders.push(`${rel(path)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "A busy label is the verb plus three ASCII dots, not U+2026\n" +
        '(UI-CONVENTIONS, "Labels").\n\n' +
        offenders.join("\n")
    ).toEqual([]);
  });

  // The matchers themselves, against strings written to fool them. A scan that
  // agrees with the tree proves nothing about what it would notice.
  describe("the matchers", () => {
    it("tells a colour class from a size or alignment class", () => {
      for (const token of [
        "bg-secondary",
        "text-destructive",
        "hover:text-destructive",
        "border-destructive/30",
        "dark:bg-input/30",
        "hover:bg-[var(--status-error-bg)]",
      ]) {
        expect(setsColor(token), token).toBe(true);
      }
      for (const token of [
        "text-sm",
        "text-xs",
        "text-left",
        "text-2xl",
        "text-balance",
        "border",
        "border-2",
        "border-b",
        "border-dashed",
        "border-none",
        "shadow-xs",
        "outline-none",
        "outline-hidden",
        "w-full",
        "mt-2",
      ]) {
        expect(setsColor(token), token).toBe(false);
      }
    });

    // Each of these escaped an earlier draft of the matcher.
    it("sees through a stack of variants, and knows a gradient stop", () => {
      expect(setsColor("dark:hover:bg-secondary")).toBe(true);
      expect(setsColor("md:dark:focus-visible:text-destructive")).toBe(true);
      expect(restyles("md:dark:h-9")).toBe("height");
      expect(setsColor("from-amber-400")).toBe(true);
      expect(setsColor("via-red-500")).toBe(true);
      expect(setsColor("to-red-600")).toBe(true);
      // size-* is a height as much as a width, and a width is allowed.
      expect(restyles("size-12")).toBe("height");
    });

    // Each of these escaped or was wrongly caught by the second draft.
    it("keeps a border side and width together, and a ring width out", () => {
      for (const token of [
        "border-t-4",
        "border-x-2",
        "border-b-8",
        "border-l-px",
        "ring-2",
        "ring-inset",
        "ring-offset-2",
        "ring-[3px]",
        "text-[13px]",
        "text-[1.25rem]",
        "text-[length:var(--brand-size)]",
        "text-[length:calc(1rem+2px)]",
        "ring-[length:var(--ring-width)]",
      ]) {
        expect(setsColor(token), token).toBe(false);
      }
      for (const token of [
        "border-t-destructive",
        "ring-ring/50",
        "ring-destructive",
        "text-[var(--brand-primary)]",
        "text-[#ff8c5a]",
      ]) {
        expect(setsColor(token), token).toBe(true);
      }
    });

    it("tells a height, padding or radius class from a width or margin", () => {
      expect(restyles("h-9")).toBe("height");
      expect(restyles("h-auto")).toBe("height");
      expect(restyles("min-h-16")).toBe("height");
      expect(restyles("p-0")).toBe("padding");
      expect(restyles("px-1.5")).toBe("padding");
      expect(restyles("rounded-r-none")).toBe("radius");
      expect(restyles("rounded")).toBe("radius");
      expect(restyles("w-full")).toBe(null);
      expect(restyles("mt-2")).toBe(null);
      expect(restyles("xl:hidden")).toBe(null);
      expect(restyles("relative")).toBe(null);
      expect(restyles("-ml-px")).toBe(null);
    });

    it("reads className across lines and out of a cn() call", () => {
      const source = [
        "<Button",
        "  onClick={fn}",
        '  className={cn("rounded-r-none", on && "bg-secondary")}',
        '  size="icon"',
        ">",
        "  <Icon />",
        "</Button>",
      ].join("\n");
      const [button] = buttonElements(source);
      expect(classTokens(button.open)).toContain("rounded-r-none");
      expect(classTokens(button.open)).toContain("bg-secondary");
    });

    it("ignores a className passthrough, which is the parent's to answer for", () => {
      const [button] = buttonElements("<Button className={className} />");
      expect(classTokens(button.open)).toEqual([]);
    });

    it("finds an icon size class in a body but not a min-w or a label class", () => {
      const matches = (body: string) =>
        [...body.matchAll(ICON_SIZE_CLASS)].map((m) => m[0]);
      expect(matches('<Icon className="h-4 w-4" />')).toEqual(["h-4", "w-4"]);
      expect(matches('<Icon className="size-4" />')).toEqual(["size-4"]);
      // A size the variant does not give, so not a restatement of it.
      expect(matches('<Icon className="size-3.5" />')).toEqual([]);
      expect(matches('<span className="min-w-[1.25rem]" />')).toEqual([]);
      expect(matches('<span className="max-h-16 w-full" />')).toEqual([]);
      expect(matches('<span className="hidden md:inline" />')).toEqual([]);
      // The sanctioned escape hatch: a size the variant does not already give.
      expect(matches('<Icon className="size-5" />')).toEqual([]);
      expect(matches('<Icon className="size-6" />')).toEqual([]);
      // ...but an h/w pair is wrong at any number, because it loses silently.
      expect(matches('<Icon className="h-5 w-5" />')).toEqual(["h-5", "w-5"]);
    });

    it("finds a raw <button> and not a <Button> or an identifier", () => {
      expect(openingTags("<button type='button'>", "button")).toHaveLength(1);
      expect(openingTags("<Button type='button'>", "button")).toHaveLength(0);
      expect(openingTags("<buttonish />", "button")).toHaveLength(0);
    });
  });
});
