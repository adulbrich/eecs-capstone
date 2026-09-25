import { useCallback, useEffect, useMemo, useState } from "react";
import { parseBidsCsv } from "#/lib/placement/csv";
import {
  clearStoredWorkspace,
  EMPTY_WORKSPACE,
  readStoredWorkspace,
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

  useEffect(() => {
    setWorkspace(readStoredWorkspace() ?? EMPTY_WORKSPACE);
  }, []);

  useEffect(() => {
    if (workspace === null) {
      return;
    }
    // The empty workspace is the cleared one: leave the key absent rather
    // than write the defaults straight back after "Clear all data".
    if (workspace === EMPTY_WORKSPACE) {
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

  return { workspace, bids, saveFailed, update, replace, clear };
}

export type PlacementWorkspace = ReturnType<typeof usePlacementWorkspace>;
