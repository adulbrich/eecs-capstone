import { readFileSync } from "node:fs";

/**
 * The `pattern` on one `aws_cloudwatch_log_metric_filter` in
 * `infra/alarms.tf`, unescaped, read from the file so a test runs the pattern
 * production applies rather than a copy of it.
 */
export function metricFilterPattern(resource: string): string {
  const opener = `resource "aws_cloudwatch_log_metric_filter" "${resource}" {`;
  const block =
    readFileSync("infra/alarms.tf", "utf8").split(opener)[1]?.split("\n}")[0] ??
    "";
  const line = block
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("pattern "));
  // An HCL string with only `\\` escapes is also a JSON string.
  return JSON.parse(line?.slice(line.indexOf("=") + 1).trim() ?? '""');
}

/**
 * A `%regex%` pattern in the subset CloudWatch documents that JavaScript
 * reads the same way: letters, digits, space, its nine symbols, and its
 * operators other than parentheses, which it does not support. Every `|`
 * alternative starts with `^`, since a phrase matched anywhere in a line can
 * be text a stranger sent.
 */
export const ANCHORED_REGEX = /^%\^[\w :#=@/;,\-^$?[\]{}|\\*+.]+%$/u;

/**
 * CloudWatch's match for a standalone `%regex%` pattern: the event matches
 * when the expression finds a match in it, case sensitive. Only faithful for a
 * pattern `ANCHORED_REGEX` accepts, so each test holds its pattern to that
 * first.
 */
export function metricFilterMatches(pattern: string, line: string): boolean {
  return new RegExp(pattern.slice(1, -1), "u").test(line);
}
