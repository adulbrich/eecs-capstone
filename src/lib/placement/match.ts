import { normalizeTitle } from "#/lib/placement/csv";
import type { WorkspaceProject } from "#/lib/placement/types";

/**
 * Proposes a project for a bid title that matches none (#661). A survey
 * spells a title its own way: cut short, reworded, mistyped. Scores run from
 * 0 to 1 and only rank candidates; staff confirm every match.
 */

/** The score at which the best candidate is offered as the suggestion. */
export const SUGGESTION_THRESHOLD = 0.6;

/** A cut-short title has to be this long before its prefix counts. */
const MIN_PREFIX_LENGTH = 8;

export interface ProjectCandidate {
  key: string;
  score: number;
  title: string;
}

/** Adjacent character pairs, by code point so an emoji is one character. */
function bigrams(text: string): Map<string, number> {
  const chars = Array.from(text);
  const counts = new Map<string, number>();
  for (let i = 0; i < chars.length - 1; i++) {
    const pair = `${chars[i]}${chars[i + 1]}`;
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/**
 * Dice's coefficient over the two normalized titles' character pairs, raised
 * when the bid title is the start of the project title, which is what a
 * survey that truncates long titles produces. 0 when either title has fewer
 * than two characters, since there is nothing to compare.
 */
export function titleSimilarity(bidTitle: string, projectTitle: string) {
  const bid = normalizeTitle(bidTitle);
  const project = normalizeTitle(projectTitle);
  if (bid === project) {
    return bid === "" ? 0 : 1;
  }
  const a = bigrams(bid);
  const b = bigrams(project);
  let total = 0;
  let shared = 0;
  for (const [pair, count] of a) {
    shared += Math.min(count, b.get(pair) ?? 0);
    total += count;
  }
  for (const count of b.values()) {
    total += count;
  }
  const dice = total === 0 ? 0 : (2 * shared) / total;
  const bidLength = Array.from(bid).length;
  if (bidLength >= MIN_PREFIX_LENGTH && project.startsWith(bid)) {
    // Covering half the project title reads as 0.8, all of it as 1.
    const cover = bidLength / Array.from(project).length;
    return Math.max(dice, 0.6 + 0.4 * cover);
  }
  return dice;
}

/** Every project, most similar to the bid title first, then by title. */
export function rankProjects(
  bidTitle: string,
  projects: readonly Pick<WorkspaceProject, "key" | "title">[]
): ProjectCandidate[] {
  return projects
    .map((p) => ({
      key: p.key,
      title: p.title,
      score: titleSimilarity(bidTitle, p.title),
    }))
    .sort((x, y) => y.score - x.score || x.title.localeCompare(y.title));
}

/** The best candidate when it clears the threshold, otherwise none. */
export function suggestProject(
  ranked: readonly ProjectCandidate[]
): ProjectCandidate | undefined {
  const [best] = ranked;
  return best !== undefined && best.score >= SUGGESTION_THRESHOLD
    ? best
    : undefined;
}
