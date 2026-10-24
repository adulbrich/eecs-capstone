// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  "data-overflows:border-b",
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

describe("a dialog body's separator", () => {
  // jsdom has no layout, so the heights are faked and the observer callback is
  // fired by hand, as a resize in a browser would. The shared
  // `installResizeObserver` stub keeps no callback to fire.
  let scrollHeight = 100;
  const fire: (() => void)[] = [];

  beforeEach(() => {
    scrollHeight = 100;
    fire.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          fire.push(callback);
        }
        observe() {
          // no-op
        }
        unobserve() {
          // no-op
        }
        disconnect() {
          // no-op
        }
      }
    );
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 100,
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // jsdom defines both on Element.prototype, so deleting the fakes restores
    // them.
    Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
  });

  function resize(height: number) {
    scrollHeight = height;
    act(() => {
      for (const callback of fire) {
        callback();
      }
    });
  }

  it.each([
    [
      "dialog-body",
      () => (
        <Dialog open>
          <DialogContent>
            <DialogTitle>Title</DialogTitle>
            <DialogBody>Fields</DialogBody>
          </DialogContent>
        </Dialog>
      ),
    ],
    [
      "alert-dialog-body",
      () => (
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Title</AlertDialogTitle>
            <AlertDialogBody>Fields</AlertDialogBody>
          </AlertDialogContent>
        </AlertDialog>
      ),
    ],
  ])("%s shows only while its content overflows", (slot, ui) => {
    render(ui());
    const body = document.querySelector(`[data-slot="${slot}"]`);
    expect(body?.hasAttribute("data-overflows")).toBe(false);
    resize(300);
    expect(body?.hasAttribute("data-overflows")).toBe(true);
    resize(100);
    expect(body?.hasAttribute("data-overflows")).toBe(false);
  });
});
