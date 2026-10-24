// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOverflows } from "../use-overflows";

/**
 * jsdom has no layout, so the heights are faked and a resize is fired by hand.
 * The shared `installResizeObserver` stub records nothing, and these tests
 * need the observed elements and the callback.
 */

let scrollHeight = 100;
let clientHeight = 100;
const observed = new Set<Element>();
const callbacks: (() => void)[] = [];
const disconnect = vi.fn();
const originals = {
  clientHeight: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
  ),
  scrollHeight: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "scrollHeight"
  ),
};

beforeEach(() => {
  scrollHeight = 100;
  clientHeight = 100;
  observed.clear();
  callbacks.length = 0;
  disconnect.mockClear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe(target: Element) {
        observed.add(target);
      }
      unobserve(target: Element) {
        observed.delete(target);
      }
      disconnect() {
        observed.clear();
        disconnect();
      }
    }
  );
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) {
      Object.defineProperty(HTMLElement.prototype, key, descriptor);
    }
  }
});

function Box({ children }: { children: ReactNode }) {
  const [ref, overflows] = useOverflows<HTMLDivElement>();
  return (
    <div data-overflows={overflows || undefined} data-testid="box" ref={ref}>
      {children}
    </div>
  );
}

function boxOverflows(): boolean {
  return document
    .querySelector('[data-testid="box"]')
    ?.hasAttribute("data-overflows") as boolean;
}

function resize(height: number) {
  scrollHeight = height;
  act(() => {
    for (const callback of callbacks) {
      callback();
    }
  });
}

// A MutationObserver delivers on a microtask, after the DOM change.
async function flushMutations() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useOverflows", () => {
  it.each([
    ["content two pixels taller", 102, 100, true],
    ["content one pixel taller, a rounding artefact", 101, 100, false],
    ["content exactly as tall", 100, 100, false],
    ["an empty or hidden box", 0, 0, false],
  ])("is %s: %i over %i gives %s", (_, scroll, client, expected) => {
    scrollHeight = scroll;
    clientHeight = client;
    render(<Box>x</Box>);
    expect(boxOverflows()).toBe(expected);
  });

  it("observes the box and each child, since a capped box keeps its size as content grows", () => {
    render(
      <Box>
        <p>one</p>
        <p>two</p>
      </Box>
    );
    const box = document.querySelector('[data-testid="box"]');
    expect([...observed]).toEqual([box, ...(box?.children ?? [])]);
  });

  it("observes and measures a child added while open", async () => {
    const { rerender } = render(
      <Box>
        <p>one</p>
      </Box>
    );
    scrollHeight = 300;
    rerender(
      <Box>
        <p>one</p>
        <p data-testid="error">two</p>
      </Box>
    );
    await flushMutations();
    expect(
      observed.has(document.querySelector('[data-testid="error"]') as Element)
    ).toBe(true);
    expect(boxOverflows()).toBe(true);
  });

  it("measures when the box's own text changes, which resizes no observed element", async () => {
    const { rerender } = render(<Box>short</Box>);
    expect(boxOverflows()).toBe(false);
    scrollHeight = 300;
    rerender(<Box>a much longer text</Box>);
    await flushMutations();
    expect(boxOverflows()).toBe(true);
  });

  it("follows a resize both ways", () => {
    render(<Box>x</Box>);
    resize(300);
    expect(boxOverflows()).toBe(true);
    resize(100);
    expect(boxOverflows()).toBe(false);
  });

  it("disconnects when the box unmounts", () => {
    const { unmount } = render(<Box>x</Box>);
    unmount();
    expect(disconnect).toHaveBeenCalled();
  });
});
