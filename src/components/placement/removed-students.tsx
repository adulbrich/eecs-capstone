import { Undo2, UserMinus } from "lucide-react";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import {
  type RemovedStudent,
  removeStudents,
  restoreStudent,
} from "#/lib/placement/workspace";

/**
 * Takes one student out of placement (#679): the Bids tab's two views and
 * the Results board each carry one.
 */
export function RemoveStudentButton({
  email,
  name,
  update,
}: {
  email: string;
  name: string;
  update: PlacementWorkspace["update"];
}) {
  return (
    <Button
      aria-label={`Remove ${name || email} from placement`}
      onClick={() => update((w) => removeStudents(w, [email]))}
      size="sm"
      type="button"
      variant="ghost"
    >
      <UserMinus aria-hidden="true" />
      Remove
    </Button>
  );
}

/** The students taken out of placement by hand, each with a way back. */
export function RemovedStudents({
  removed,
  update,
}: {
  removed: readonly RemovedStudent[];
  update: PlacementWorkspace["update"];
}) {
  if (removed.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="placement-removed-heading"
      className="mt-6 rounded-md border px-3 py-2 text-sm"
    >
      <h2 className="font-medium" id="placement-removed-heading">
        Removed from placement{" "}
        <span className="font-normal text-muted-foreground">
          {removed.length} {removed.length === 1 ? "student" : "students"}
        </span>
      </h2>
      <p className="mt-1">
        A removed student is out of every run, the board, the analytics and both
        downloads until you restore them, and stays removed when new bids or a
        new roster are uploaded. A pre-approval goes with them: a project added
        from the roster shrinks, or disappears, without them. Their pins are
        kept for when they come back.
      </p>
      <ul className="mt-2 space-y-1">
        {removed.map((s) => (
          <li className="flex flex-wrap items-center gap-2" key={s.email}>
            <span>
              {s.name ? `${s.name} (${s.email})` : s.email}
              {!s.listed && (
                <span className="text-muted-foreground">
                  {" "}
                  - not in the bids or the roster now
                </span>
              )}
            </span>
            <Button
              aria-label={`Restore ${s.name || s.email}`}
              onClick={() => update((w) => restoreStudent(w, s.email))}
              size="sm"
              type="button"
              variant="outline"
            >
              <Undo2 aria-hidden="true" />
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
