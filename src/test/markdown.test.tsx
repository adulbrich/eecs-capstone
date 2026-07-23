// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "#/components/markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders nothing for empty input", () => {
    const { container } = render(<Markdown>{""}</Markdown>);
    expect(container.textContent).toBe("");
    const { container: c2 } = render(<Markdown>{null}</Markdown>);
    expect(c2.textContent).toBe("");
  });

  it("renders a bullet list", () => {
    const { container } = render(
      <Markdown>{"- ingests sensor data\n- stores it in Postgres"}</Markdown>
    );
    const items = container.querySelectorAll("li");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("ingests sensor data");
  });

  it("renders emphasis", () => {
    const { container } = render(<Markdown>{"a **telemetry** run"}</Markdown>);
    expect(container.querySelector("strong")?.textContent).toBe("telemetry");
  });

  it("renders links with a safe rel and target", () => {
    const { container } = render(
      <Markdown>{"see [the docs](https://example.com/x)"}</Markdown>
    );
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/x");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });

  it("clamps every heading level to h3", () => {
    const { container } = render(<Markdown>{"# Top\n\n#### Fourth"}</Markdown>);
    expect(container.querySelector("h1")).toBeNull();
    expect(container.querySelector("h4")).toBeNull();
    expect(container.querySelectorAll("h3").length).toBe(2);
  });

  it("does not execute or emit raw HTML", () => {
    const { container } = render(
      <Markdown>{"<script>alert(1)</script><b>raw</b>"}</Markdown>
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("alert(1)");
  });

  it("does not render images", () => {
    const { container } = render(
      <Markdown>{"![a rover](https://example.com/r.png)"}</Markdown>
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders a GFM table", () => {
    const { container } = render(
      <Markdown>{"| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>
    );
    expect(container.querySelector("table")).toBeTruthy();
  });

  it("renders checked and unchecked GFM task list items differently", () => {
    const { container } = render(
      <Markdown>{"- [x] done\n- [ ] todo"}</Markdown>
    );
    const boxes = container.querySelectorAll("input[type=checkbox]");
    expect(boxes.length).toBe(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(false);
  });
});
