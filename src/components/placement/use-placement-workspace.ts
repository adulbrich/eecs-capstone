import { useCallback, useEffect, useMemo, useState } from "react";
import { parseBidsCsv } from "#/lib/placement/csv";
import { resolveFilePlugin, toStandard } from "#/lib/placement/plugins";
import { pastedRoster } from "#/lib/placement/plugins/paste";
import {
  mergeRoster,
  parseRosterCsv,
  resolveRosterProjects,
} from "#/lib/placement/roster";
import {
  clearStoredWorkspace,
  EMPTY_WORKSPACE,
  inputFingerprint,
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
  // What reading the workspace set aside, as a column mapping it could not
  // read (#735), until the next import or clear.
  const [notices, setNotices] = useState<string[]>([]);

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
    setNotices((stored.status === "ok" && stored.notices) || []);
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

  const replace = useCallback(
    (next: Workspace, setAside: readonly string[] = []) => {
      setNotices([...setAside]);
      setWorkspace(next);
    },
    []
  );
  const clear = useCallback(() => {
    setNotices([]);
    setWorkspace(EMPTY_WORKSPACE);
  }, []);

  const storedBids = workspace?.bids;
  const projects = workspace?.projects;
  const titleMatches = workspace?.titleMatches;
  const storedRoster = workspace?.roster;
  const removed = workspace?.removed;
  // The roster through its plugin, if any, then the roster parser. A pasted
  // list has one plugin; a file is read as staff chose, or as detected.
  const roster = useMemo(() => {
    if (storedRoster === undefined) {
      return null;
    }
    const plugin =
      storedRoster.source.kind === "pasted"
        ? pastedRoster
        : resolveFilePlugin("roster", storedRoster.text, storedRoster.readAs);
    // Every plugin gets the project list, as the contract says, though no
    // roster plugin reads it yet; a roster is small enough to re-read.
    const conversion = toStandard(plugin, storedRoster.text, {
      projects: projects ?? [],
      mapping: storedRoster.mapping,
    });
    return { ...parseRosterCsv(conversion.text), plugin, conversion };
  }, [storedRoster, projects]);
  // The bids converted again on every read, so a plugin that names projects
  // (a survey answer that pins its student) sees the list as it is now.
  const bidsSource = useMemo(() => {
    if (!storedBids || projects === undefined) {
      return null;
    }
    const plugin = resolveFilePlugin(
      "bids",
      storedBids.text,
      storedBids.readAs
    );
    return {
      plugin,
      ...toStandard(plugin, storedBids.text, {
        projects,
        mapping: storedBids.mapping,
      }),
    };
  }, [storedBids, projects]);
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
    if (bidsSource === null || projects === undefined) {
      return null;
    }
    const parsed = parseBidsCsv(bidsSource.text, projects, titleMatches);
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
  }, [bidsSource, projects, titleMatches, roster, assignments, removed]);

  // What a run reads, hashed once per change for every tab that asks
  // whether the last run is stale. The stored project list, not the roster's
  // additions: those follow from the roster text, which is hashed too.
  const parameters = workspace?.parameters;
  const fingerprint = useMemo(
    () =>
      inputFingerprint({
        projects: projects ?? EMPTY_WORKSPACE.projects,
        parameters: parameters ?? EMPTY_WORKSPACE.parameters,
        bids: workspace?.bids ?? null,
        titleMatches,
        roster: storedRoster,
      }),
    [projects, parameters, workspace?.bids, titleMatches, storedRoster]
  );

  return {
    workspace,
    bids,
    /**
     * The bids file as standard CSV, the plugin that converted it (null for
     * a file already in the standard format) and what that plugin noticed.
     */
    bidsSource,
    /** `inputFingerprint` of the workspace now, to compare with a result's. */
    fingerprint,
    roster,
    assignments,
    /**
     * Every project a run places students on: the stored list, then any the
     * roster adds (#670). `workspace.projects` is the stored list alone.
     */
    placementProjects: allProjects,
    saveFailed,
    unreadable,
    /** What reading the workspace set aside, to say on the page. */
    notices,
    changedElsewhere,
    update,
    replace,
    clear,
  };
}

export type PlacementWorkspace = ReturnType<typeof usePlacementWorkspace>;
