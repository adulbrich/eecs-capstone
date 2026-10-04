import { parseProjectTitles } from "#/lib/placement/csv";
import { PROJECTS_FORMAT, writeFormat } from "#/lib/placement/formats";
import type { PastePlugin } from "#/lib/placement/plugins/types";
import { parseRosterList, rosterCsv } from "#/lib/placement/roster";

/** Emails pasted into the Roster tab's box (#665): no projects, ever. */
export const pastedRoster: PastePlugin = {
  id: "paste-roster",
  label: "roster",
  dataset: "roster",
  input: "paste",
  toStandard: (text) => {
    const { entries, issues } = parseRosterList(text);
    return { text: rosterCsv(entries), issues };
  },
};

/** A column of project titles pasted into the Projects tab (#664). */
export const pastedTitles: PastePlugin = {
  id: "paste-titles",
  label: "project titles",
  dataset: "projects",
  input: "paste",
  toStandard: (text) => {
    const { projects, issues } = parseProjectTitles(text);
    return {
      text: writeFormat(
        PROJECTS_FORMAT,
        projects.map((p) => ({ title: p.title }))
      ),
      issues,
    };
  },
};
