/**
 * Radix primitives measure themselves through `react-use-size`, which needs a
 * `ResizeObserver` jsdom does not implement. Any suite rendering a component
 * that contains one (Checkbox, Popover, DropdownMenu) has to install this
 * first. See the Radix polyfill note in docs/QUIRKS.md.
 */
export function installResizeObserver() {
  globalThis.ResizeObserver = class {
    disconnect() {
      // no-op
    }
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
  };
}
