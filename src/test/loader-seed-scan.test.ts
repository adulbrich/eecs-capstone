import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every once-only seed in `src/`, held to the census in ADR-0029.
 *
 * A `useState`, `useRef` or `useReducer` initializer and an uncontrolled
 * `defaultValue` or `defaultChecked` run once, at mount. A TanStack Form
 * `defaultValues` is nearly as sticky: new defaults reach the form only
 * until a field is touched, and a blur touches one, so a form the user has
 * so much as tabbed through keeps its mount-time values (QUIRKS, TanStack
 * Form). One seeded from loader data keeps whatever frame it mounted on, so
 * it is correct only while `src/router.tsx` blocks on a stale reload (#474,
 * #499), which the router tests at the end hold. ADR-0029's Consequences
 * sort the seeds into four classes and say why the unkeyed ones rely on that
 * option by decision; this is the part that is enforced, in the style of
 * `error-text-scan.test.ts`. A rule in a doc is remembered: the first version
 * of that ADR said the routes seeding from loader data were keyed, and a
 * sweep found six that were not.
 *
 * What it cannot see is where a value came from. It finds every initializer
 * that is not a plain literal and asks that somebody has said which class it
 * is in; the reading of data flow is the classifier's, written beside the
 * entry.
 */

/**
 * The four classes, as ADR-0029 names them.
 *
 * - A: seeded from loader data, no key, no resync of its own. Correct because
 *   the router blocks, by decision. The two forms here resync while untouched,
 *   and the router option covers a user who touches one before a reload.
 * - B: seeded from loader data and keyed on the record, so a new record
 *   remounts it.
 * - C: seeded once and resynced by an effect.
 * - D: once-only but not seeded from loader data. Out of scope, and listed so
 *   nobody chases it again.
 */
type SeedClass = "A" | "B" | "C" | "D";

/**
 * The census, keyed on the file and the initializer rather than a line number.
 *
 * A hook or input key is `<file>: <kind>(<initializer>)` with the whitespace
 * collapsed and any type parameter dropped, so reformatting or retyping a site
 * does not churn it; two identical initializers in one file share an entry. A
 * form key is `<file>: defaultValues` alone, because the object is one entry
 * per field and a key that changed whenever a field was added would teach
 * people to update this list without reading it.
 */
const CENSUS = new Map<string, { class: SeedClass; why: string }>([
  // Class A.
  [
    'src/components/custom-line-actions.tsx: useState(line.sourcingNote ?? "")',
    {
      class: "A",
      why: "the sourcing note, from the line /admin/inventory/requests loads",
    },
  ],
  [
    "src/components/inventory-form.tsx: defaultValues",
    {
      class: "A",
      why: "/inventory/$itemId/edit passes the loader's item as `initial`; /inventory/new passes none",
    },
  ],
  [
    "src/components/project-form.tsx: defaultValues",
    {
      class: "A",
      why: "/projects/$projectId/edit passes the loader's project as `initial`; /projects/new passes none",
    },
  ],
  [
    "src/components/role-select.tsx: useState(initialRole)",
    {
      class: "A",
      why: "the user's role, from the record /admin/users/$userId loads",
    },
  ],
  [
    "src/components/staff-program-section.tsx: useState(() => programs.map((p) => p.id))",
    {
      class: "A",
      why: "the project's programs, from the record /projects/$projectId loads",
    },
  ],
  [
    "src/components/staff-program-section.tsx: useState(teamsSupported)",
    {
      class: "A",
      why: "the project's teams supported, from the record /projects/$projectId loads",
    },
  ],
  [
    "src/components/staff-program-section.tsx: useState(() => !acceptingApplicants)",
    {
      class: "A",
      why: "the team-full flag, from the record /projects/$projectId loads",
    },
  ],
  [
    "src/routes/_authed/admin/mentors/index.tsx: useState(mentor.mentorTeamCount)",
    { class: "A", why: "a mentor's team count, from the listing's loader" },
  ],
  // Class B.
  [
    "src/routes/_authed/admin/categories/$categoryId.tsx: useState(category.name)",
    { class: "B", why: "keyed on the seeded name and type" },
  ],
  [
    'src/routes/_authed/admin/categories/$categoryId.tsx: useState(category.type ?? "")',
    { class: "B", why: "keyed on the seeded name and type" },
  ],
  [
    "src/routes/_authed/admin/programs/$programId.tsx: useState(program.courseId)",
    { class: "B", why: "keyed on `String(program.updatedAt)`" },
  ],
  [
    "src/routes/_authed/admin/programs/$programId.tsx: useState(program.courseName)",
    { class: "B", why: "keyed on `String(program.updatedAt)`" },
  ],
  [
    'src/routes/_authed/admin/programs/$programId.tsx: useState(program.description ?? "")',
    { class: "B", why: "keyed on `String(program.updatedAt)`" },
  ],
  [
    'src/routes/_authed/admin/programs/$programId.tsx: useState(program.expectedTeams === null ? "" : String(program.expectedTeams))',
    { class: "B", why: "keyed on `String(program.updatedAt)`" },
  ],
  [
    'src/routes/_authed/admin/programs/$programId.tsx: useState(program.termCount === null ? "" : String(program.termCount))',
    { class: "B", why: "keyed on `String(program.updatedAt)`" },
  ],
  // Class C.
  [
    "src/components/instructor-manager.tsx: useState(initial)",
    {
      class: "C",
      why: "`useEffect(() => setInstructors(initial), [initial])` resyncs it",
    },
  ],
  [
    "src/lib/use-debounced-draft.ts: useState(value)",
    {
      class: "C",
      why: "the hook owns its resync, and its docstring names this failure for a search box",
    },
  ],
  [
    "src/lib/use-debounced-draft.ts: useRef(value)",
    {
      class: "C",
      why: "what the draft last committed or synced to, the bookkeeping behind that resync",
    },
  ],
  // Class D.
  [
    "src/components/comment-thread.tsx: useState(comment.content)",
    {
      class: "D",
      why: "comments are fetched in an effect, since the detail loader carries none, and opening an edit resets the draft from the saved text",
    },
  ],
  [
    "src/components/custom-request-form.tsx: defaultValues",
    {
      class: "D",
      why: "the first card's name is the search query that found nothing, from the URL",
    },
  ],
  [
    'src/components/local-time.tsx: useState(() => (iso ? utcText(iso, dateOnly) : ""))',
    {
      class: "D",
      why: "display only: the server's text, replaced by an effect with the local one",
    },
  ],
  [
    "src/components/proposer-picker.tsx: useState(value)",
    {
      class: "D",
      why: "captures the saved address at mount on purpose, to tell a pending change from it",
    },
  ],
  [
    "src/components/similar-projects.tsx: useState(readCollapsed)",
    {
      class: "D",
      why: "a lazy initializer reading a per-viewer preference from localStorage",
    },
  ],
  [
    "src/components/staff-proposer-section.tsx: useState(proposer.email)",
    {
      class: "D",
      why: "the proposer record the staff panel fetches in an effect, not loader data",
    },
  ],
  [
    "src/components/staff-proposer-section.tsx: useState(proposer.studentProposed)",
    {
      class: "D",
      why: "the proposer record the staff panel fetches in an effect, not loader data",
    },
  ],
  [
    "src/routes/_authed/admin/traffic.tsx: useState(defaultSort)",
    {
      class: "D",
      why: "a constant built from the table's `sortBy` prop, which every caller passes as a literal",
    },
  ],
  [
    'src/routes/_authed/profile.tsx: defaultValue(user.affiliation ?? "")',
    {
      class: "D",
      why: "the signed-in user from route context, not loader data",
    },
  ],
  [
    'src/routes/_authed/profile.tsx: defaultValue(user.linkedin ?? "")',
    {
      class: "D",
      why: "the signed-in user from route context, not loader data",
    },
  ],
  [
    'src/routes/_authed/profile.tsx: defaultValue(user.name ?? "")',
    {
      class: "D",
      why: "the signed-in user from route context, not loader data",
    },
  ],
  [
    "src/routes/_authed/profile.tsx: useState(Boolean(user.wantsToMentor))",
    {
      class: "D",
      why: "the signed-in user from route context, not loader data",
    },
  ],
  [
    "src/routes/_authed/profile.tsx: useState(user.mentorTeamCount ?? 1)",
    {
      class: "D",
      why: "the signed-in user from route context, not loader data",
    },
  ],
]);

const SRC_DIR = join(process.cwd(), "src");
// Compared by full path, not by name, for the reason
// `src/lib/__tests__/vocabulary-scan.ts` gives: a bare-name check would
// exempt any directory called `test` anywhere under `src/`, a production one
// included, and would do so silently.
const TEST_DIR = join(SRC_DIR, "test");

const CLOSER: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * Just past the string or template literal that opens at `start`. A quoted
 * string ends at its line's end at the latest, as it must in JavaScript, so
 * an apostrophe in JSX text misreads the rest of that line and no further. A
 * backtick has no such stop: a stray one runs to the next backtick, or to the
 * end of the file.
 */
function stringEnd(source: string, start: number): number {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
    } else if (quote !== "`" && char === "\n") {
      return i;
    } else if (quote === "`" && char === "$" && source[i + 1] === "{") {
      i = closeOf(source, i + 1);
    } else if (char === quote) {
      return i + 1;
    }
  }
  return source.length;
}

function isCommentStart(source: string, i: number): boolean {
  return source[i] === "/" && (source[i + 1] === "/" || source[i + 1] === "*");
}

/** Just past the comment that opens at `start`, or at the newline ending it. */
function commentEnd(source: string, start: number): number {
  if (source[start + 1] === "/") {
    const end = source.indexOf("\n", start);
    return end === -1 ? source.length : end;
  }
  const end = source.indexOf("*/", start + 2);
  return end === -1 ? source.length : end + 2;
}

/**
 * The index of the bracket closing the one at `open`.
 *
 * Counted, not matched: a line regex misses an initializer Biome has wrapped
 * over several lines, and a non-greedy one stops at the first `)` of
 * `useState(() => programs.map((p) => p.id))`. Strings and template holes
 * are skipped so a bracket inside one is text; comments are gone already,
 * since every caller reads what `blankComments` returns. `<` counts only when
 * `open` is one, which is a type parameter list, and the `>` of an `=>` never
 * closes it: `useState<Record<string, () => void>>(x)` is one list.
 *
 * Known limit, inert in this tree: a regex literal holding a bracket, or JSX
 * text holding an apostrophe, inside the initializer would miscount. Neither
 * occurs in one; fix it if one ever does rather than in advance.
 */
function closeOf(source: string, open: number): number {
  const angles = source[open] === "<";
  const expected: string[] = [];
  for (let i = open; i < source.length; i++) {
    const char = source[i];
    if (char === '"' || char === "'" || char === "`") {
      i = stringEnd(source, i) - 1;
    } else if (char in CLOSER) {
      expected.push(CLOSER[char]);
    } else if (angles && char === "<") {
      expected.push(">");
    } else if (
      char === expected.at(-1) &&
      !(char === ">" && source[i - 1] === "=")
    ) {
      expected.pop();
      if (expected.length === 0) {
        return i;
      }
    }
  }
  return source.length;
}

/**
 * `text` split on its top-level commas, stopping early at the first top-level
 * character in `stops`, which is how a property value ends at the `,` or `}`
 * after it.
 */
function splitTopLevel(text: string, stops = ""): string[] {
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' || char === "'" || char === "`") {
      i = stringEnd(text, i) - 1;
    } else if (char in CLOSER) {
      i = closeOf(text, i);
    } else if (stops.includes(char)) {
      parts.push(text.slice(from, i));
      return parts;
    } else if (char === ",") {
      parts.push(text.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(text.slice(from));
  return parts;
}

/** One line, no padding inside brackets, no trailing comma: Biome's wrap undone. */
function normalize(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/([([{]) /g, "$1")
    .replace(/,? ?([)\]}])/g, "$1")
    .trim();
}

const PRIMITIVE =
  /^(?:-?\d[\d_]*(?:\.\d+)?|true|false|null|undefined|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$]*`)$/;
const EMPTY_COLLECTION = /^new (?:Set|Map)(?:<[^()]*>)?\(\)$/;
const LAZY = /^\(\)\s*=>\s*([\s\S]*)$/;
const PROPERTY = /^\s*(?:[\w$]+|"[^"]*"|'[^']*')\s*:\s*([\s\S]*)$/;
// One named type, so `[] as Row[] && loaderData.rows` is not a literal.
const ASSERTION =
  /^\s+(?:satisfies|as)\s+(?:const|[\w$.]+(?:<[^()]*>)?(?:\[\])*)\s*$/;

/**
 * A plain literal, which cannot carry loader data: a primitive, an empty
 * `Set` or `Map`, a lazy initializer returning one, or an array or object
 * built only from them, with or without a `satisfies` or `as` after it.
 * Everything else is a seed somebody has to classify.
 */
function isLiteral(raw: string): boolean {
  const text = raw.trim();
  if (text === "" || PRIMITIVE.test(text) || EMPTY_COLLECTION.test(text)) {
    return true;
  }
  const lazy = LAZY.exec(text)?.[1];
  if (lazy !== undefined) {
    return !lazy.startsWith("{") && isLiteral(lazy);
  }
  const open = text[0];
  if (!(open in CLOSER)) {
    return false;
  }
  const close = closeOf(text, 0);
  const rest = text.slice(close + 1);
  if (rest.trim() !== "" && !ASSERTION.test(rest)) {
    return false;
  }
  const items = splitTopLevel(text.slice(1, close)).filter(
    (item) => item.trim() !== ""
  );
  if (open === "(") {
    return items.length === 1 && isLiteral(items[0]);
  }
  if (open === "[") {
    return items.every(isLiteral);
  }
  return items.every((item) => {
    const value = PROPERTY.exec(item)?.[1];
    return value !== undefined && isLiteral(value);
  });
}

type Kind =
  | "useState"
  | "useRef"
  | "useReducer"
  | "defaultValues"
  | "defaultValue"
  | "defaultChecked";

interface Seed {
  /** The initializer's source, comments blanked. */
  init: string;
  kind: Kind;
}

/**
 * Whether a `/` at `at` opens a regex literal rather than dividing: it does
 * after an operator, an opening bracket or `return`, and not after a value.
 * `<` and `>` are left out, so the `/` of a JSX `</div>` or `/>` is never one.
 */
function opensRegex(source: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /\s/.test(source[i])) {
    i--;
  }
  return (
    i < 0 ||
    "(,=:[!&|?{};+-*%~^".includes(source[i]) ||
    /\breturn$/.test(source.slice(Math.max(0, i - 6), i + 1))
  );
}

/** Just past the regex literal whose opening `/` is at `start`. */
function regexEnd(source: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === "\\") {
      i++;
    } else if (char === "\n") {
      return i;
    } else if (inClass) {
      inClass = char !== "]";
    } else if (char === "[") {
      inClass = true;
    } else if (char === "/") {
      return i + 1;
    }
  }
  return source.length;
}

/**
 * `source` with every comment blanked to spaces, newlines kept, so it has the
 * same length and every offset into it is an offset into the file.
 *
 * The scan runs over this rather than asking of each match whether its line
 * looks like a comment. A per-line test silently drops a real seed that
 * follows a block comment on its line, such as a JSX label comment before an
 * `<Input defaultValue={user.name} />`, or a `//` inside a string earlier on
 * it. Strings, template literals and their `${}` holes, and regex literals are
 * walked so a `//` or `/*` inside one is text.
 *
 * It is a lexer without a parser, so some shapes fool it: JSX text holding
 * `http://` (it blanks the rest of the line) or `/*` (the rest of the file),
 * a stray backtick in JSX text (it flips template state for the rest of the
 * file), and a regex literal right after `)`, as in `if (x) /\/\//.test(y)`.
 * None occurs in `src/` today, and a test further down holds it to
 * TypeScript's parser over every file the scan reads, so one that appears
 * fails loudly rather than dropping a seed.
 *
 * It keeps its own template and hole state rather than calling `stringEnd`
 * on a backtick, because a comment inside a `${}` hole must be blanked, and
 * `stringEnd` jumps a hole whole.
 */
function blankComments(source: string): string {
  const out = source.split("");
  // One entry per open template hole: the `{` depth inside it.
  const holes: number[] = [];
  let inTemplate = false;
  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j++) {
      if (out[j] !== "\n") {
        out[j] = " ";
      }
    }
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inTemplate) {
      if (char === "\\") {
        i++;
      } else if (char === "`") {
        inTemplate = false;
      } else if (char === "$" && source[i + 1] === "{") {
        holes.push(0);
        inTemplate = false;
        i++;
      }
    } else if (char === '"' || char === "'") {
      i = stringEnd(source, i) - 1;
    } else if (char === "`") {
      inTemplate = true;
    } else if (isCommentStart(source, i)) {
      const end = commentEnd(source, i);
      blank(i, end);
      i = end - 1;
    } else if (char === "/" && opensRegex(source, i)) {
      i = regexEnd(source, i) - 1;
    } else if (char === "{" && holes.length > 0) {
      holes[holes.length - 1]++;
    } else if (char === "}" && holes.length > 0) {
      if (holes.at(-1) === 0) {
        holes.pop();
        inTemplate = true;
      } else {
        holes[holes.length - 1]--;
      }
    }
  }
  return out.join("");
}

const HOOK = /\b(useState|useRef|useReducer)\s*(?=[<(])/g;
const FORM_DEFAULTS = /\bdefaultValues\s*([:,}])/g;
const UNCONTROLLED = /\b(defaultValue|defaultChecked)=([{"'])/g;

function hookSeeds(source: string): Seed[] {
  const seeds: Seed[] = [];
  for (const match of source.matchAll(HOOK)) {
    const kind = match[1] as Kind;
    let open = match.index + match[0].length;
    if (source[open] === "<") {
      open = closeOf(source, open) + 1;
      while (/\s/.test(source[open] ?? "")) {
        open++;
      }
    }
    if (source[open] !== "(") {
      continue;
    }
    const args = source.slice(open + 1, closeOf(source, open));
    // `useReducer(reducer, initialArg, init?)`: the reducer is not a seed.
    const init =
      kind === "useReducer" ? splitTopLevel(args).slice(1).join(",") : args;
    seeds.push({ init, kind });
  }
  return seeds;
}

function formSeeds(source: string): Seed[] {
  const seeds: Seed[] = [];
  for (const match of source.matchAll(FORM_DEFAULTS)) {
    const start = match.index + match[0].length;
    const init =
      match[1] === ":"
        ? splitTopLevel(source.slice(start), ",)}")[0]
        : // Shorthand, `{ defaultValues }`: a variable, never a literal.
          "defaultValues";
    seeds.push({ init, kind: "defaultValues" });
  }
  for (const match of source.matchAll(UNCONTROLLED)) {
    const open = match.index + match[0].length - 1;
    const init =
      match[2] === "{"
        ? source.slice(open + 1, closeOf(source, open))
        : source.slice(open, stringEnd(source, open));
    seeds.push({ init, kind: match[1] as Kind });
  }
  return seeds;
}

/** Every once-only initializer in `source` that is not a plain literal. */
function onceOnlySeeds(source: string): Seed[] {
  const code = blankComments(source);
  return [...hookSeeds(code), ...formSeeds(code)].filter(
    (seed) => !isLiteral(seed.init)
  );
}

function label(seed: Seed): string {
  return seed.kind === "defaultValues"
    ? "defaultValues"
    : `${seed.kind}(${normalize(seed.init)})`;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== TEST_DIR && entry.name !== "__tests__") {
        yield* sourceFiles(path);
      }
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) {
      yield path;
    }
  }
}

function treeSeeds(): Set<string> {
  const found = new Set<string>();
  for (const path of sourceFiles(SRC_DIR)) {
    const file = relative(process.cwd(), path);
    for (const seed of onceOnlySeeds(readFileSync(path, "utf8"))) {
      found.add(`${file}: ${label(seed)}`);
    }
  }
  return found;
}

function labelsIn(source: string): string[] {
  return onceOnlySeeds(source).map(label);
}

describe("once-only seeds", () => {
  it("are all in ADR-0029's census, and the census has none left over", () => {
    const found = treeSeeds();
    const unclassified = [...found].filter((site) => !CENSUS.has(site)).sort();
    expect(
      unclassified,
      "A once-only initializer that is not a plain literal is not in the\n" +
        "census. It is read at mount (a form's until a field is touched), so\n" +
        "one seeded from loader data keeps whatever frame it mounted on. Read\n" +
        "the census in\n" +
        "docs/adr/0029-a-revisit-waits-for-its-loader.md, classify each site\n" +
        "below as A, B, C or D in CENSUS with the reason, and name a new A, B\n" +
        "or C site in that ADR's Consequences too. A site whose initializer\n" +
        "was edited appears here under its new text; move its entry.\n\n" +
        unclassified.join("\n")
    ).toEqual([]);

    // The other direction: a site that is gone should lose its entry, so
    // the census cannot grow stale.
    const stale = [...CENSUS.keys()].filter((site) => !found.has(site)).sort();
    expect(
      stale,
      "These census entries match nothing in src/. Remove them, and from\n" +
        "ADR-0029's Consequences if it names them.\n\n" +
        stale.join("\n")
    ).toEqual([]);
  });

  // The walk itself, against the shapes a line grep misses.
  it("finds a multi-line initializer", () => {
    expect(
      labelsIn(`
        const [name, setName] = useState(
          record.name ??
            fallback
        );
      `)
    ).toEqual(["useState(record.name ?? fallback)"]);
  });

  it("finds a lazy initializer and reads past its nested parens", () => {
    expect(
      labelsIn("const [ids] = useState(() => record.items.map((i) => i.id));")
    ).toEqual(["useState(() => record.items.map((i) => i.id))"]);
  });

  it("finds an initializer behind a type parameter, and drops the type", () => {
    expect(
      labelsIn(`
        const [role] = useState<UserRole>(initialRole);
        const [handlers] = useState<Record<string, () => void>>(
          record.handlers
        );
        const [view] = useState<
          Partial<Record<Field, Suggestion>>
        >(record.view);
      `)
    ).toEqual([
      "useState(initialRole)",
      "useState(record.handlers)",
      "useState(record.view)",
    ]);
  });

  it("finds a useRef and a useReducer's initial argument, not its reducer", () => {
    expect(
      labelsIn(`
        const seen = useRef(record.value);
        const [state] = useReducer(reducer, record, init);
        const [count] = useReducer(reducer, 0);
      `)
    ).toEqual(["useRef(record.value)", "useReducer(record, init)"]);
  });

  it("finds form defaults and uncontrolled inputs", () => {
    expect(
      labelsIn(`
        const form = useForm({
          defaultValues: {
            name: initial?.name ?? "",
          } satisfies FormValues,
          validators: { onSubmit: schema },
        });
        const blank = useForm({ defaultValues: { name: "", count: 0 } });
        <Input defaultValue={user.name ?? ""} />
        <Checkbox defaultChecked={user.optIn} />
        <Tabs defaultValue="details" />
        <Checkbox defaultChecked />
      `)
    ).toEqual([
      "defaultValues",
      'defaultValue(user.name ?? "")',
      "defaultChecked(user.optIn)",
    ]);
  });

  it("skips plain literals, comments, and brackets inside strings", () => {
    expect(
      labelsIn(`
        const [open] = useState(false);
        const [error] = useState<string | null>(null);
        const [draft] = useState("");
        const [rows] = useState<Row[]>([]);
        const [picked] = useState(() => new Set<string>());
        const [filters] = useState({ page: 1, q: "" } as const);
        const inputRef = useRef<HTMLInputElement>(null);
        const [step] = useState(
          // Where the flow starts.
          "address"
        );
        // useState(record.name) in a comment is prose.
        /**
         * So is useState(record.name) in a docstring.
         */
        const [title] = useState(record.title ?? "(untitled)");
        /* seed */ const [a] = useState(record.x);
        {/* Name */}<Input defaultValue={user.name} />
        const sep = " // "; const [v] = useState(loaderData.v);
        const [rows2] = useState([] as Row[] && loaderData.rows);
      `)
    ).toEqual([
      'useState(record.title ?? "(untitled)")',
      "useState(record.x)",
      "useState(loaderData.v)",
      "useState([] as Row[] && loaderData.rows)",
      "defaultValue(user.name)",
    ]);
  });

  it("ends a quoted string at its line's end, so an apostrophe in JSX text misreads only that line", () => {
    // Were the apostrophe read as a string running on to the next quote, the
    // comment below would be taken for its text and never blanked.
    expect(
      labelsIn(`
        <p>Don't lose this</p>
        // useState(record.prose) is prose.
        const [v] = useState(record.v);
      `)
    ).toEqual(["useState(record.v)"]);
  });
});

/**
 * `source` with every comment TypeScript's parser finds blanked the way
 * `blankComments` blanks one: the oracle the hand lexer is held to.
 *
 * A comment is trivia, the gap before a token, so every leaf of the tree
 * `getChildren` builds (which adds the punctuation and keywords the AST
 * leaves implicit) has the trivia from its full start rescanned with the
 * parser's own scanner. JSX text is the one leaf whose full text is text
 * rather than trivia, so it is never rescanned, and a comment in JSX braces
 * is found as the trivia before that expression's `}`. JSDoc nodes are
 * skipped, because the comment each one parses is also the trivia of the
 * token after it. This is exact for every construct: nothing is left out of
 * the comparison.
 */
function blankCommentsByParser(path: string, source: string): string {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    file.languageVariant,
    source
  );
  const out = source.split("");
  const visit = (node: ts.Node): void => {
    if (
      node.kind >= ts.SyntaxKind.FirstJSDocNode &&
      node.kind <= ts.SyntaxKind.LastJSDocNode
    ) {
      return;
    }
    const children = node.getChildren(file);
    if (children.length > 0) {
      for (const child of children) {
        visit(child);
      }
      return;
    }
    if (node.kind === ts.SyntaxKind.JsxText) {
      return;
    }
    scanner.resetTokenState(node.pos);
    for (;;) {
      const kind = scanner.scan();
      if (
        kind === ts.SyntaxKind.SingleLineCommentTrivia ||
        kind === ts.SyntaxKind.MultiLineCommentTrivia
      ) {
        for (let j = scanner.getTokenStart(); j < scanner.getTokenEnd(); j++) {
          if (out[j] !== "\n") {
            out[j] = " ";
          }
        }
      } else if (
        kind !== ts.SyntaxKind.WhitespaceTrivia &&
        kind !== ts.SyntaxKind.NewLineTrivia &&
        kind !== ts.SyntaxKind.ShebangTrivia
      ) {
        break;
      }
    }
  };
  visit(file);
  return out.join("");
}

/** Where `blankComments` first parts from the parser in `path`, if it does. */
function lexerDivergence(path: string): string | undefined {
  const source = readFileSync(path, "utf8");
  const hand = blankComments(source);
  const parser = blankCommentsByParser(path, source);
  if (hand === parser) {
    return;
  }
  let at = 0;
  while (hand[at] === parser[at]) {
    at++;
  }
  const before = source.slice(0, at).split("\n");
  const what =
    hand[at] === " "
      ? "blanks code the parser keeps"
      : "keeps a comment the parser blanks";
  return (
    `${relative(process.cwd(), path)}:${before.length}:${(before.at(-1)?.length ?? 0) + 1} ` +
    `(offset ${at}) ${what}: ${JSON.stringify(source.slice(at, at + 40))}`
  );
}

describe("the comment blanking the scan reads through", () => {
  it("agrees with TypeScript's parser on every file the scan walks", () => {
    const diverged = [...sourceFiles(SRC_DIR)]
      .map(lexerDivergence)
      .filter((line) => line !== undefined);
    expect(
      diverged,
      "blankComments, the hand lexer the seed scan reads through, diverged\n" +
        "from TypeScript's parser at the first offset named below. Where it\n" +
        "blanks code, a seed there is dropped without a red test; where it\n" +
        "keeps a comment, prose there reads as a seed. Its docstring lists\n" +
        "the shapes known to fool it. Teach blankComments the construct at\n" +
        "that offset, in src/test/loader-seed-scan.test.ts, and add a fixture\n" +
        "for it beside the others.\n\n" +
        diverged.join("\n")
    ).toEqual([]);
  });
});

/**
 * The option the census rests on. Class A is correct only while a stale
 * revisit blocks, so reverting the router default, or opting one route out,
 * silently changes what every class A seed means. Both read the source with
 * comments blanked, so a commented-out line counts for nothing.
 */
describe("the stale reload mode the census rests on", () => {
  const remedy =
    "ADR-0029's class A seeds are correct only while a stale revisit\n" +
    "blocks. Before changing this, apply the remedy in the Consequences of\n" +
    "docs/adr/0029-a-revisit-waits-for-its-loader.md to every class A seed\n" +
    "the change reaches, and reclassify them in CENSUS.";

  it("is blocking by default, in src/router.tsx", () => {
    const router = blankComments(
      readFileSync(join(SRC_DIR, "router.tsx"), "utf8")
    );
    expect(
      /\bdefaultStaleReloadMode:\s*"blocking"/.test(router),
      `src/router.tsx no longer sets defaultStaleReloadMode: "blocking".\n${remedy}`
    ).toBe(true);
  });

  it("is not overridden by any route's loader", () => {
    const overrides = [...sourceFiles(join(SRC_DIR, "routes"))]
      .filter((path) =>
        /\bstaleReloadMode\b/.test(blankComments(readFileSync(path, "utf8")))
      )
      .map((path) => relative(process.cwd(), path))
      .sort();
    expect(
      overrides,
      `These routes set staleReloadMode on their loader.\n${remedy}\n\n` +
        overrides.join("\n")
    ).toEqual([]);
  });
});
