import { useCallback, useEffect, useMemo, useState } from "react";
import { parseBidsCsv } from "#/lib/placement/csv";
import {
  clearStoredWorkspace,
  EMPTY_WORKSPACE,
  isEmptyWorkspace,
  readStoredWorkspace,
  WORKSPACE_STORAGE_KEY,
  type Workspace,
  writeStoredWorkspace,
} from "#/lib/placement/workspace";

/**
 * The placement page's one piece of state. It is read from localStorage
 * after mount, never during render, so the server's HTML and the first
 * client render agree (null until then), and written back on every change.
 * The bids are parsed here from the stored text, so a new project list
 * re-matches them without anyone re-importing the file.
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
  const bids = useMemo(
    () =>
      bidsText === undefined || projects === undefined
        ? null
        : parseBidsCsv(bidsText, projects),
    [bidsText, projects]
  );

  return {
    workspace,
    bids,
    saveFailed,
    unreadable,
    changedElsewhere,
    update,
    replace,
    clear,
  };
}

export type PlacementWorkspace = ReturnType<typeof usePlacementWorkspace>;
