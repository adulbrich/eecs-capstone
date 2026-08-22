// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";

afterEach(cleanup);

function Fixture() {
  return (
    <Tabs defaultValue="cart">
      <TabsList>
        <TabsTrigger value="cart">Cart (2)</TabsTrigger>
        <TabsTrigger value="active">Active (1)</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
      </TabsList>
      <TabsContent value="cart">cart panel</TabsContent>
      <TabsContent value="active">active panel</TabsContent>
      <TabsContent value="history">history panel</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("exposes a tablist with selected state", () => {
    render(<Fixture />);
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Cart (2)", selected: true })
    ).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "Active (1)", selected: false })
    ).toBeTruthy();
  });

  it("moves between tabs with the arrow keys", async () => {
    // The behavior the raw buttons could not offer: one tab stop for the whole
    // strip, arrows to move within it.
    render(<Fixture />);
    await userEvent.tab();
    expect(screen.getByRole("tab", { name: "Cart (2)" })).toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Active (1)" })).toHaveFocus();
    // A second Tab leaves the trigger group entirely and lands on the
    // panel content, proving there is one tab stop for the whole strip
    // rather than one per trigger: three plain tabindex=0 buttons would
    // each keep their own stop, so a second Tab would still land on a
    // trigger ("History"), not skip past all of them.
    await userEvent.tab();
    for (const t of screen.getAllByRole("tab")) {
      expect(t).not.toHaveFocus();
    }
    expect(screen.getByRole("tabpanel")).toHaveFocus();
  });

  it("shows only the selected panel", async () => {
    render(<Fixture />);
    expect(screen.getByText("cart panel")).toBeTruthy();
    expect(screen.queryByText("active panel")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Active (1)" }));
    expect(screen.getByText("active panel")).toBeTruthy();
  });
});
