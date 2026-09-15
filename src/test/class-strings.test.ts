import { describe, expect, it } from "vitest";
import { classStrings } from "./shared/class-strings";

/**
 * The extractor two scans read the tree through.
 *
 * It is worth its own tests because a gap here is silent in both of them: a
 * class string it fails to assemble is a rule that quietly stops applying,
 * which is how `error-text-scan` missed `panel.tsx` while it read line by line.
 */

const read = (source: string) => [...classStrings(source)];

describe("classStrings", () => {
  it("reads a plain attribute, where nothing is conditional", () => {
    expect(read('<p className="mt-1 text-sm">x</p>')).toEqual([
      { all: "mt-1 text-sm", unconditional: "mt-1 text-sm" },
    ]);
  });

  it("joins the literals of one cn() into one string", () => {
    expect(
      read('<p className={cn("text-destructive", "text-sm")}>x</p>')
    ).toEqual([
      {
        all: "text-destructive text-sm",
        unconditional: "text-destructive text-sm",
      },
    ]);
  });

  it("reads an attribute spread over several lines", () => {
    const source = [
      "<p",
      "  className={cn(",
      '    "font-medium text-sm",',
      '    danger && "text-destructive"',
      "  )}",
      ">",
    ].join("\n");
    expect(read(source)).toEqual([
      {
        all: "font-medium text-sm text-destructive",
        unconditional: "font-medium text-sm",
      },
    ]);
  });

  /**
   * clsx's object form, which `cn` supports. Ending the attribute at the first
   * `}` cut the string in half here and hid everything after the object, so the
   * braces are counted instead.
   */
  it("reads past a nested object without losing what follows it", () => {
    expect(
      read('<p className={cn({ "text-destructive": err }, "text-sm")}>x</p>')
    ).toEqual([{ all: "text-destructive text-sm", unconditional: "text-sm" }]);
  });

  it("reads past a nested call and a ternary", () => {
    expect(
      read(
        '<p className={cn(base(), on ? "text-destructive" : "text-muted-foreground", "text-sm")}>'
      )
    ).toEqual([
      {
        all: "text-destructive text-muted-foreground text-sm",
        unconditional: "text-sm",
      },
    ]);
  });

  it("yields nothing for a passthrough, which is the parent's to answer for", () => {
    expect(read("<p className={className}>x</p>")).toEqual([]);
    expect(read("<p className={styles.error}>x</p>")).toEqual([]);
  });

  it("yields one entry per attribute, in order", () => {
    expect(
      read('<div className="a"><p className={cn("b", x && "c")}>y</p></div>')
    ).toEqual([
      { all: "a", unconditional: "a" },
      { all: "b c", unconditional: "b" },
    ]);
  });

  /**
   * A template literal's static text is genuinely unconditional, so it counts
   * as such. What matters here is that its braces do not end the attribute,
   * and that the interpolation is carried through as the opaque text it is:
   * neither rule can match a class inside it, which is the cautious direction
   * for both, since an unreadable class is one they must not assume is there.
   */
  it("carries a template literal's interpolation through as opaque text", () => {
    const interpolation = ["$", "{tone}"].join("");
    const [entry] = read(`<p className={\`text-sm ${interpolation}\`}>x</p>`);
    expect(entry.all).toBe(`text-sm ${interpolation}`);
    expect(entry.unconditional).toBe(`text-sm ${interpolation}`);
    expect(entry.unconditional.includes("text-destructive")).toBe(false);
  });

  it("does not let a brace inside a string end the attribute early", () => {
    expect(
      read('<p className={cn("text-sm", weird ? "a}b" : "c")}>x</p>')
    ).toEqual([{ all: "text-sm a}b c", unconditional: "text-sm" }]);
  });
});
