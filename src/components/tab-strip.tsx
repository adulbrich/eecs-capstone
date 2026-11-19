import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button } from "#/components/ui/button";
import { TabsList } from "#/components/ui/tabs";
import { cn } from "#/lib/utils";

/** How far the tabs scroll past either edge, from a scroll box's sizes. */
export function tabOverflow(box: {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
}): { left: boolean; right: boolean } {
  // A pixel of slack: zoom and subpixel layout leave a fraction behind.
  return {
    left: box.scrollLeft > 1,
    right: box.scrollLeft + box.clientWidth < box.scrollWidth - 1,
  };
}

/**
 * A tab list too wide for its box (#717, #739), as the placement page's five
 * tabs are on a phone: the strip scrolls sideways inside itself rather than
 * widening the page, and says so: a fade and a chevron at each edge with tabs past it. The chevron
 * is for a pointer; a keyboard moves between tabs with the arrow keys, which
 * scroll the focused tab into view, so it stays out of the tab order. The
 * focus ring draws inside each tab, which the scroll box would otherwise
 * clip.
 */
export function TabStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const box = ref.current;
    if (box) {
      const next = tabOverflow(box);
      setMore((was) =>
        was.left === next.left && was.right === next.right ? was : next
      );
    }
  }, []);
  useEffect(() => {
    const box = ref.current;
    if (!box) {
      return;
    }
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(box);
    return () => {
      box.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [measure]);
  // A tab's count changes its width without resizing the box.
  useEffect(measure);

  const scroll = (direction: 1 | -1) => {
    const box = ref.current;
    box?.scrollBy({
      behavior: "smooth",
      left: direction * box.clientWidth * 0.6,
    });
  };
  return (
    <div className="relative">
      <TabsList
        className={cn(
          "overflow-x-auto [&>*]:shrink-0 [&>*]:whitespace-nowrap [&>*]:focus-visible:ring-inset",
          // Room for the chevron only while it shows: padding that is always
          // there is overflow of its own, and a cue over empty space.
          more.right && "pr-10"
        )}
        ref={ref}
      >
        {children}
      </TabsList>
      {more.left && (
        <>
          <div
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-y-0 left-8 w-8 bg-gradient-to-r to-transparent"
          />
          <Button
            aria-label="Earlier tabs"
            className="absolute top-1/2 left-0 -translate-y-1/2"
            onClick={() => scroll(-1)}
            size="icon-sm"
            tabIndex={-1}
            type="button"
            variant="outline"
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
        </>
      )}
      {more.right && (
        <>
          <div
            aria-hidden="true"
            className="from-background pointer-events-none absolute inset-y-0 right-8 w-8 bg-gradient-to-l to-transparent"
          />
          <Button
            aria-label="More tabs"
            className="absolute top-1/2 right-0 -translate-y-1/2"
            onClick={() => scroll(1)}
            size="icon-sm"
            tabIndex={-1}
            type="button"
            variant="outline"
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </>
      )}
    </div>
  );
}
