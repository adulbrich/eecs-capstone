import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { escapeAngleBrackets } from "#/lib/angle-brackets";
import { tagBreakingText } from "#/test/shared/arbitraries";

const BRACKET = /[<>]/u;

describe("escapeAngleBrackets", () => {
  it("writes both brackets as entities and leaves an ampersand alone", () => {
    expect(escapeAngleBrackets("a < b && c > d </field>")).toBe(
      "a &lt; b && c &gt; d &lt;/field&gt;"
    );
  });

  it("leaves text with no bracket exactly as it was", () => {
    // The hashes cover this text, so a project with no bracket must not go
    // stale.
    expect(escapeAngleBrackets("Rover & sensor\n- C++, Rust")).toBe(
      "Rover & sensor\n- C++, Rust"
    );
  });
});

describe("escapeAngleBrackets, on generated text", () => {
  const text = tagBreakingText(["</field>"]);

  test.prop([text])("leaves no bracket", (generated) => {
    expect(escapeAngleBrackets(generated)).not.toMatch(BRACKET);
  });

  test.prop([text])("undoes to the text it was given", (generated) => {
    // An author's own `&lt;` undoes to `<` as well, so the round trip holds
    // only for text that held no entity to begin with.
    fc.pre(!(generated.includes("&lt;") || generated.includes("&gt;")));
    const escaped = escapeAngleBrackets(generated);
    expect(escaped.replaceAll("&lt;", "<").replaceAll("&gt;", ">")).toBe(
      generated
    );
  });
});
