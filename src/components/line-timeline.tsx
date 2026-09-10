import type { TimelineEvent } from "#/lib/inventory-timeline";
import { LocalTime } from "./local-time";

/**
 * The three events at most that a line has had, oldest first. Built by
 * `lineTimeline` in `#/lib/inventory-timeline` from the line's own columns;
 * this only draws what it is handed, so the staff queue and the requester's
 * page cannot disagree about what happened.
 */
export function LineTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol aria-label="Timeline" className="space-y-3">
      {events.map((event) => (
        <li className="text-sm" key={event.kind}>
          <p className="font-medium">
            {event.label}
            {event.actor && (
              <span className="font-normal text-muted-foreground">
                {" "}
                by {event.actor}
              </span>
            )}
          </p>
          <p className="text-muted-foreground text-xs">
            <LocalTime value={event.at} />
          </p>
          {event.note && (
            <p className="mt-1 whitespace-pre-wrap">{event.note}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
