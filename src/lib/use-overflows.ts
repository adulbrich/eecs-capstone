import { type RefCallback, useCallback, useState } from "react";

/**
 * Whether an element's content is taller than the element, so it scrolls.
 * Pass the returned ref to the element.
 *
 * A ResizeObserver on the element alone misses content that grows inside a
 * box already at its cap, since the box keeps its size. So each child is
 * observed as well, and a MutationObserver re-observes when nodes come and go
 * and re-measures when text changes, which may resize no observed element.
 * The two heights are rounded apart, so at a fractional zoom a box that fits
 * can read one pixel over; a single pixel does not count. Without
 * ResizeObserver (jsdom) the answer stays false.
 */
export function useOverflows<T extends HTMLElement>(): [
  RefCallback<T>,
  boolean,
] {
  const [overflows, setOverflows] = useState(false);
  const ref = useCallback((element: T | null) => {
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      setOverflows(element.scrollHeight - element.clientHeight > 1);
    };
    const resize = new ResizeObserver(measure);
    const observeAll = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) {
        resize.observe(child);
      }
    };
    const mutation = new MutationObserver(() => {
      observeAll();
      measure();
    });
    observeAll();
    mutation.observe(element, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);
  return [ref, overflows];
}
