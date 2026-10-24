// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { CommandDialog } from "#/components/ui/command";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";

/**
 * A tall dialog keeps its header and footer on screen and scrolls only its
 * body (UI-CONVENTIONS, "A tall dialog scrolls inside itself"). `npx shadcn
 * add` regenerates a `ui/` file wholesale, so a re-add of `dialog` or
 * `alert-dialog` would drop these classes without a type error; this is what
 * notices.
 */

afterEach(cleanup);

const CONTENT = [
  "flex-col",
  "max-h-[calc(100dvh-2rem)]",
  "short:max-h-dvh",
  "overflow-y-auto",
];
const BODY = [
  "-my-1",
  "min-h-0",
  "flex-1",
  "gap-4",
  "overflow-y-auto",
  "empty:hidden",
  "*:shrink-0",
];
const PINNED = ["shrink-0"];

function classesOf(slot: string): string[] {
  const el = document.querySelector(`[data-slot="${slot}"]`);
  if (!el) {
    throw new Error(`no ${slot} rendered`);
  }
  return el.className.split(/\s+/);
}

describe("DialogContent", () => {
  it("caps its height, scrolls its body and pins its header and footer", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Title</DialogTitle>
            <DialogDescription>Description</DialogDescription>
          </DialogHeader>
          <DialogBody>Fields</DialogBody>
          <DialogFooter>Buttons</DialogFooter>
        </DialogContent>
      </Dialog>
    );
    expect(classesOf("dialog-content")).toEqual(
      expect.arrayContaining(CONTENT)
    );
    expect(classesOf("dialog-body")).toEqual(expect.arrayContaining(BODY));
    expect(classesOf("dialog-header")).toEqual(expect.arrayContaining(PINNED));
    expect(classesOf("dialog-footer")).toEqual(expect.arrayContaining(PINNED));
  });
});

describe("AlertDialogContent", () => {
  it("caps its height, scrolls its body and pins its header and footer", () => {
    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <AlertDialogDescription>Description</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>Fields</AlertDialogBody>
          <AlertDialogFooter>Buttons</AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
    expect(classesOf("alert-dialog-content")).toEqual(
      expect.arrayContaining(CONTENT)
    );
    expect(classesOf("alert-dialog-body")).toEqual(
      expect.arrayContaining(BODY)
    );
    expect(classesOf("alert-dialog-header")).toEqual(
      expect.arrayContaining(PINNED)
    );
    expect(classesOf("alert-dialog-footer")).toEqual(
      expect.arrayContaining(PINNED)
    );
  });
});

describe("CommandDialog", () => {
  it("keeps overflow-hidden over the base scroll, since cmdk scrolls its own list", () => {
    render(
      <CommandDialog open>
        <span>Palette</span>
      </CommandDialog>
    );
    screen.getByText("Palette");
    const classes = classesOf("dialog-content");
    expect(classes).toContain("overflow-hidden");
    expect(classes).not.toContain("overflow-y-auto");
  });
});
