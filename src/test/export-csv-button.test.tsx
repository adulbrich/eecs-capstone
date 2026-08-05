// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { ExportCsvButton } from "#/components/export-csv-button";

/**
 * jsdom implements neither `Blob` payload introspection nor the
 * `createObjectURL`/`revokeObjectURL` pair, and a real anchor's `.click()`
 * would have jsdom attempt to navigate to a fake `blob:` URL. Stubbing all
 * three lets the tests observe what the component built and did with it
 * without depending on real browser download behavior.
 */
class BlobStub {
  options?: BlobPropertyBag;
  parts: BlobPart[];
  constructor(parts: BlobPart[], options?: BlobPropertyBag) {
    this.parts = parts;
    this.options = options;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface AnchorStub {
  click: ReturnType<typeof vi.fn>;
  download: string;
  href: string;
  remove: ReturnType<typeof vi.fn>;
}

let anchor: AnchorStub;
let createObjectURL: Mock<(obj: Blob | MediaSource) => string>;
let revokeObjectURL: Mock<(url: string) => void>;
let appendChildSpy: ReturnType<typeof vi.spyOn>;
let createElementSpy: ReturnType<typeof vi.spyOn>;
// jsdom does not implement these, so there is nothing for vi.spyOn to wrap;
// the originals are saved so real `URL.createObjectURL` (undefined here) is
// restored rather than left as the mock from the previous test.
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  vi.stubGlobal("Blob", BlobStub);

  // Assigning the two static methods directly, rather than replacing the
  // whole `URL` global (e.g. via `vi.stubGlobal("URL", { ...URL, ... })`),
  // matters: spreading `URL` copies none of its own enumerable properties
  // (they live on the prototype), so a spread-based replacement silently
  // turns `URL` into a plain object with no `new URL(...)` constructor at
  // all, which jsdom's own internals depend on and which breaks rendering
  // with no visible error at the call site.
  createObjectURL = vi.fn((_obj: Blob | MediaSource) => "blob:mock-url");
  revokeObjectURL = vi.fn((_url: string) => {
    // no-op
  });
  URL.createObjectURL = createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;

  anchor = { click: vi.fn(), download: "", href: "", remove: vi.fn() };
  const realCreateElement = document.createElement.bind(document);
  createElementSpy = vi
    .spyOn(document, "createElement")
    .mockImplementation((tag: string) =>
      tag === "a"
        ? (anchor as unknown as HTMLAnchorElement)
        : realCreateElement(tag)
    );
  // The component appends the anchor before clicking it (Fix 3), so the
  // download starts reliably. The stub anchor above is a plain object, not
  // a real Node, so appendChild must be faked for it specifically rather
  // than exercised against jsdom's real Node validation. Every other
  // caller (notably Testing Library's own container, attached to
  // document.body on every render) has to keep going through the real
  // appendChild, or the rendered tree never actually lands in the
  // document and every query against it comes back empty.
  const realAppendChild = document.body.appendChild.bind(document.body);
  appendChildSpy = vi
    .spyOn(document.body, "appendChild")
    .mockImplementation((node) =>
      node === (anchor as unknown as Node) ? node : realAppendChild(node)
    );
});

afterEach(() => {
  cleanup();
  // Safety net, not the primary reset: the one test that switches to fake
  // timers already restores real ones itself once it's done with them.
  vi.useRealTimers();
  vi.unstubAllGlobals();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  createElementSpy.mockRestore();
  appendChildSpy.mockRestore();
});

describe("ExportCsvButton", () => {
  it("calls load on click and marks itself busy and aria-disabled while pending", async () => {
    const { promise, resolve } = deferred<string>();
    const load = vi.fn(() => promise);
    render(<ExportCsvButton filename="widgets" load={load} />);

    const button = screen.getByRole("button", { name: "Export CSV" });
    fireEvent.click(button);

    expect(load).toHaveBeenCalledTimes(1);
    // aria-disabled, not the native `disabled` attribute: see Fix 5 below.
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      resolve("a,b\r\n1,2");
      await promise;
    });

    await waitFor(() =>
      expect(button.getAttribute("aria-disabled")).toBe("false")
    );
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  // Documents the behavior Fix 5 exists for: the native `disabled` attribute
  // removes a focused element from the tab order and drops focus to <body>
  // in a real browser, so a keyboard user mid-table loses their position for
  // the length of the export. This assertion does NOT by itself distinguish
  // the fix from the pre-fix code under jsdom: jsdom (confirmed directly,
  // independent of React, against this project's jsdom version) never moves
  // `document.activeElement` when an element gains the `disabled` attribute,
  // however it is set. The actual mutation-provable guard against that
  // regression is the `hasAttribute("disabled")` assertion above, in "marks
  // itself busy and aria-disabled while pending": a real browser's
  // focus-eviction is a direct, spec-mandated consequence of that attribute
  // being present, so proving it is absent is what rules the regression out.
  it("keeps the button focused while an export is pending", async () => {
    const { promise, resolve } = deferred<string>();
    const load = vi.fn(() => promise);
    render(<ExportCsvButton filename="widgets" load={load} />);

    const button = screen.getByRole("button", { name: "Export CSV" });
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);

    expect(document.activeElement).toBe(button);

    await act(async () => {
      resolve("a,b\r\n1,2");
      await promise;
    });
  });

  // Regression test for the double-click protection that moving off the
  // native `disabled` attribute must not lose: without `disabled`, the
  // button stays clickable while pending, so the handler itself has to
  // refuse a second, overlapping run.
  it("ignores a second click while the first export is still pending", async () => {
    const { promise, resolve } = deferred<string>();
    const load = vi.fn(() => promise);
    render(<ExportCsvButton filename="widgets" load={load} />);

    const button = screen.getByRole("button", { name: "Export CSV" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve("a,b\r\n1,2");
      await promise;
    });
  });

  it("announces success and names the file <filename>-YYYY-MM-DD.csv", async () => {
    const load = vi.fn(() => Promise.resolve("a,b\r\n1,2"));
    render(<ExportCsvButton filename="widgets" load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() =>
      expect(screen.getByText("widgets exported.")).toBeTruthy()
    );
    expect(anchor.download).toMatch(/^widgets-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("prefixes the CSV text with the BOM when building the blob", async () => {
    const load = vi.fn(() => Promise.resolve("a,b\r\n1,2"));
    render(<ExportCsvButton filename="widgets" load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as unknown as BlobStub;
    expect(blob.parts[0]).toBe("\uFEFFa,b\r\n1,2");
  });

  it("shows the inline message and announces it when load rejects with an Error", async () => {
    const load = vi.fn(() => Promise.reject(new Error("network down")));
    render(<ExportCsvButton filename="widgets" load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(screen.getByText("network down")).toBeTruthy());
    expect(
      screen.getByText("widgets export failed: network down")
    ).toBeTruthy();
  });

  // Regression test for Fix 1: `(err as Error).message` on a non-Error
  // rejection reads as `undefined`, and `{error && ...}` then renders
  // nothing at all, so the export silently no-ops. This must fail against
  // the pre-fix code.
  it("still shows a visible message when load rejects with a plain string", async () => {
    const load = vi.fn(() => Promise.reject("boom"));
    render(<ExportCsvButton filename="widgets" load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(screen.getByText("boom")).toBeTruthy());
  });

  it("revokes the object URL after starting the download", async () => {
    // Real timers make "not yet revoked" unobservable: `setTimeout(fn, 0)`
    // fires on the next turn of the event loop, well before
    // `waitFor`'s first poll (its default interval is 50ms), so a
    // real-timer version of this test would see the revoke as already
    // having happened. Fake timers hold the callback until explicitly
    // advanced, which is what makes the deferral itself (Fix 3)
    // observable at all.
    vi.useFakeTimers();
    const load = vi.fn(() => Promise.resolve("a,b\r\n1,2"));
    render(<ExportCsvButton filename="widgets" load={load} />);

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    // `load()` here is an already-resolved promise; awaiting it takes one
    // microtask tick, which fake timers do not affect (they only stub
    // setTimeout/setInterval, not the native promise microtask queue).
    await act(async () => {
      await Promise.resolve();
    });

    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    vi.useRealTimers();
  });
});
