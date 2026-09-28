import { useCallback, useEffect, useMemo, useState } from "react";
import { parseBidsCsv } from "#/lib/placement/csv";
import {
  mergeRoster,
  parseRosterCsv,
  parseRosterList,
  resolveRosterProjects,
} from "#/lib/placement/roster";
import {
  clearStoredWorkspace,
  EMPTY_WORKSPACE,
  isEmptyWorkspace,
  readStoredWorkspace,
  setAsideRemoved,
  WORKSPACE_STORAGE_KEY,
  type Workspace,
  writeStoredWorkspace,
} from "#/lib/placement/workspace";

/**
 * The placement page's one piece of state. It is read from localStorage
 * after mount, never during render, so the server's HTML and the first
 * client render agree (null until then), and written back on every change.
 * The bids are parsed here from the stored text, so a new project list or
 * a title match re-matches them without anyone re-importing the file.
 */
export function usePlacementWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);

  // The storage event fires only in the other tabs, so this one learns that
  // a second copy of the page wrote the workspace it is about to overwrite.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // A null key is localStorage.clear(), which takes the workspace too.
      if (event.key === WORKSPACE_STORAGE_KEY || event.key === null) {
        setChangedElsewhere(true);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const stored = readStoredWorkspace();
    setUnreadable(stored.status === "unreadable");
    setWorkspace(stored.status === "ok" ? stored.workspace : EMPTY_WORKSPACE);
  }, []);

  useEffect(() => {
    if (workspace === null) {
      return;
    }
    // An empty workspace leaves the key absent rather than writing the
    // defaults straight back after "Clear all data".
    if (isEmptyWorkspace(workspace)) {
      clearStoredWorkspace();
      setSaveFailed(false);
      return;
    }
    setSaveFailed(!writeStoredWorkspace(workspace));
  }, [workspace]);

  const update = useCallback((change: (current: Workspace) => Workspace) => {
    setWorkspace((current) => (current === null ? current : change(current)));
  }, []);

  const replace = useCallback((next: Workspace) => setWorkspace(next), []);
  const clear = useCallback(() => setWorkspace(EMPTY_WORKSPACE), []);

  const bidsText = workspace?.bids?.text;
  const projects = workspace?.projects;
  const titleMatches = workspace?.titleMatches;
  const storedRoster = workspace?.roster;
  const removed = workspace?.removed;
  const roster = useMemo(() => {
    if (storedRoster === undefined) {
      return null;
    }
    return storedRoster.source.kind === "csv"
      ? parseRosterCsv(storedRoster.text)
      : parseRosterList(storedRoster.text);
  }, [storedRoster]);
  // A removed student's pre-approval goes with them (#679), so a project
  // the roster adds shrinks, or disappears, without them.
  const assignments = useMemo(
    () =>
      roster === null || projects === undefined
        ? null
        : resolveRosterProjects(
            roster.entries.filter((e) => !removed?.includes(e.email)),
            projects,
            titleMatches
          ),
    [roster, projects, titleMatches, removed]
  );
  // The listed projects plus any the roster pre-approves students for that
  // the list lacks (#670). Bids match the listed ones only: an added project
  // holds exactly its pre-approved students.
  const allProjects = useMemo(
    () =>
      assignments === null || assignments.added.length === 0
        ? (projects ?? [])
        : [...(projects ?? []), ...assignments.added],
    [projects, assignments]
  );
  const bids = useMemo(() => {
    if (bidsText === undefined || projects === undefined) {
      return null;
    }
    const parsed = parseBidsCsv(bidsText, projects, titleMatches);
    // The roster's students join the survey's, so every tab and the run
    // see one list (#665), with its pre-approvals pinned (#670).
    const merged =
      roster === null
        ? { ...parsed, notOnRoster: [], conflicts: [] }
        : {
            ...parsed,
            ...mergeRoster(parsed.students, roster.entries, assignments?.pins),
          };
    // Students removed by hand leave that list, and so every tab, the run
    // and the downloads (#679).
    const aside = setAsideRemoved(merged.students, removed);
    return {
      ...merged,
      students: aside.kept,
      removed: aside.removed,
      notOnRoster: merged.notOnRoster.filter((e) => !removed?.includes(e)),
    };
  }, [bidsText, projects, titleMatches, roster, assignments, removed]);

  return {
    workspace,
    bids,
    roster,
    assignments,
    /**
     * Every project a run places students on: the stored list, then any the
     * roster adds (#670). `workspace.projects` is the stored list alone.
     */
    placementProjects: allProjects,
    saveFailed,
    unreadable,
    changedElsewhere,
    update,
    replace,
    clear,
  };
}

export type PlacementWorkspace = ReturnType<typeof usePlacementWorkspace>;
