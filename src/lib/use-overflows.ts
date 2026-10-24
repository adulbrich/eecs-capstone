import { useCallback, useState } from "react";

/**
 * Whether an element's content is taller than the element, so it scrolls.
 * Pass the returned ref to the element.
 *
 * A ResizeObserver on the element alone misses content that grows inside a
 * box already at its cap, since the box keeps its size. So each child is
 * observed as well, and a MutationObserver re-observes when children come and
 * go. Without ResizeObserver (jsdom) the answer stays false.
 */
export function useOverflows<T extends HTMLElement>(): [
  (element: T | null) => (() => void) | undefined,
  boolean,
] {
  const [overflows, setOverflows] = useState(false);
  const ref = useCallback((element: T | null) => {
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      setOverflows(element.scrollHeight > element.clientHeight);
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
    mutation.observe(element, { childList: true });
    measure();
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, []);
  return [ref, overflows];
}
