import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { repointRosterPins } from "#/lib/placement/roster";

/**
 * The projects the roster pre-approves students for that the list lacks
 * (#670), on the Projects tab. Each is one team of exactly its pre-approved
 * students; its settings are fixed, and it goes when the roster does. A
 * title close to a listed project is likely a typo, so it offers a match.
 */
export function RosterProjects({ state }: { state: PlacementWorkspace }) {
  const { assignments, bids, update } = state;
  if (assignments === null || assignments.added.length === 0) {
    return null;
  }
  const pinned = new Map<string, number>();
  for (const key of assignments.pins.values()) {
    pinned.set(key, (pinned.get(key) ?? 0) + 1);
  }
  const nearMiss = new Map(
    assignments.nearMisses.map((m) => [m.title, m] as const)
  );
  const withoutBids = bids === null;
  return (
    <section
      aria-labelledby="placement-roster-projects-heading"
      className="mt-6 rounded-md border px-3 py-2 text-sm"
    >
      <h2 className="font-medium" id="placement-roster-projects-heading">
        Added from the roster
      </h2>
      <p className="text-muted-foreground">
        The roster pre-approves students for these projects, which are not in
        the list. Each forms one team of exactly those students: nobody else is
        placed there, it is not offered by Move or Pin here, and its settings
        are fixed. It goes away with the roster. Matching one to a listed
        project moves its students, and any pin set on it, to that project.
        {withoutBids && " They join the run once the bids are uploaded."}
      </p>
      <ul className="mt-2 flex flex-col gap-2">
        {assignments.added.map((project) => {
          const miss = nearMiss.get(project.title);
          const count = pinned.get(project.key) ?? 0;
          return (
            <li key={project.key}>
              <span className="font-medium">{project.title}</span>{" "}
              <span className="text-muted-foreground">
                {count} pre-approved {count === 1 ? "student" : "students"}
              </span>
              {miss && (
                <div
                  className="mt-1 flex flex-wrap items-center gap-2"
                  role="note"
                  style={{ color: "var(--status-warning)" }}
                >
                  <span>
                    Close to the listed project {miss.suggestion.title}.
                  </span>
                  <Button
                    onClick={() =>
                      update((w) => ({
                        ...w,
                        titleMatches: {
                          ...w.titleMatches,
                          [miss.key]: {
                            projectKey: miss.suggestion.key,
                            title: miss.title,
                          },
                        },
                        pins: repointRosterPins(w.pins, {
                          [miss.key]: { projectKey: miss.suggestion.key },
                        }),
                      }))
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Match to {miss.suggestion.title} instead
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
