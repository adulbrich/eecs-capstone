import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fc, test } from "@fast-check/vitest";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { trickyText } from "#/test/shared/arbitraries";

/**
 * Every once-only seed in `src/`, held to `CENSUS` below.
 *
 * A `useState`, `useRef` or `useReducer` initializer and an uncontrolled
 * `defaultValue` or `defaultChecked` run once, at mount. A TanStack Form
 * `defaultValues` is nearly as sticky: new defaults reach the form only until a
 * field is touched, and a blur touches one, so a form the user has so much as
 * tabbed through keeps the values it held at that first touch (QUIRKS, TanStack
 * Form). One seeded from loader data keeps whatever frame it mounted on, so it
 * is correct only while `src/router.tsx` blocks on a stale reload (#474, #499),
 * which the router tests at the end hold. ADR-0029 says why the unkeyed ones
 * rely on that option by decision; the four classes are defined above
 * `SeedClass` below, and `CENSUS` sorts every seed into one. That is the part
 * that is enforced, in the style of `error-text-scan.test.ts`. A rule in a doc is remembered: the first version
 * of that ADR said the routes seeding from loader data were keyed, and a sweep
 * found six that were not.
 *
 * What it cannot see is where a value came from. It walks each file's syntax
 * tree for initializers that are not plain literals: the argument of a hook
 * called by its own name (`useState` or `React.useState`, not an alias), a
 * `defaultValues` key, and a `defaultValue` or `defaultChecked` written on the
 * element or in an object literal spread onto it, though not in an object
 * spread in from a variable. It asks that somebody has said which class each
 * is in; the reading of data flow is the classifier's, written beside the
 * entry.
 */

/**
 * The four classes. This is their definition; ADR-0029 records the decision
 * class A rests on and points here.
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
    "src/routes/_authed/admin/mentors/index.tsx: useState(mentor.mentorTeamCount)",
    { class: "A", why: "a mentor's team count, from the listing's loader" },
  ],
  // Class B.
  [
    "src/routes/_authed/admin/categories/$categoryId.tsx: useState(category.name)",
    { class: "B", why: "keyed on the seeded name, type and description" },
  ],
  [
    'src/routes/_authed/admin/categories/$categoryId.tsx: useState(category.type ?? "")',
    { class: "B", why: "keyed on the seeded name, type and description" },
  ],
  [
    'src/routes/_authed/admin/categories/$categoryId.tsx: useState(category.description ?? "")',
    { class: "B", why: "keyed on the seeded name, type and description" },
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
  [
    "src/lib/use-search-draft.ts: useState(q)",
    {
      class: "C",
      why: "the last q read on the page the box mounted on, set during render whenever the location is on that page",
    },
  ],
  // Class D.
  [
    "src/components/categorize-backfill-dialog.tsx: useState(EMPTY)",
    {
      class: "D",
      why: "a module constant, the zero tally a run starts from; never loader data",
    },
  ],
  [
    "src/components/staff-categories-section.tsx: useState(proposal.description)",
    {
      class: "D",
      why: "a Regenerate answer held in component state, keyed by the parent on its type and name; never loader data",
    },
  ],
  [
    "src/components/staff-categories-section.tsx: useState(proposal.name)",
    {
      class: "D",
      why: "a Regenerate answer held in component state, keyed by the parent on its type and name; never loader data",
    },
  ],
  [
    "src/components/staff-categories-section.tsx: useState(proposal.type)",
    {
      class: "D",
      why: "a Regenerate answer held in component state, keyed by the parent on its type and name; never loader data",
    },
  ],
  [
    "src/lib/use-search-draft.ts: useState(pathname)",
    {
      class: "D",
      why: "the pathname the search box mounted on, fixed for its life on purpose; the router's location, not loader data",
    },
  ],
  [
    "src/components/admin-data-table.tsx: useRef(open)",
    {
      class: "D",
      why: "a group's open state on the previous render, to move the focus when it closes; the page's own state, not loader data",
    },
  ],
  [
    "src/components/approve-dialog.tsx: useState(EMPTY_PICKUP)",
    {
      class: "D",
      why: "blank pickup terms, a module constant; a line's dialog copies the item's location in when it opens on a blank form, not at mount, and a request's copies nothing (ADR-0065)",
    },
  ],
  [
    "src/components/inventory-lifecycle-panel.tsx: useState(EMPTY_PICKUP)",
    {
      class: "D",
      why: "blank pickup terms, a module constant; openDialogFor reads the item's stored terms or location each time the dialog opens",
    },
  ],
  [
    "src/components/placement/add-project-dialog.tsx: useState(EMPTY)",
    {
      class: "D",
      why: "a blank new project, a module constant; reset to it whenever the dialog closes",
    },
  ],
  [
    "src/components/placement/column-mapping.tsx: useState(() => seed(initial ?? suggestMapping(dataset, headers), dataset, headers))",
    {
      class: "D",
      why: "the column mapping being edited, from the file staff uploaded and the workspace in this browser, never loader data; the editor mounts when opened and remounts for a new file",
    },
  ],
  [
    "src/components/placement/column-mapping.tsx: useState(() => initial === undefined ? [] : droppedColumns(initial, dataset))",
    {
      class: "D",
      why: "what the stored column mapping lost to fit the editor's dataset, from the workspace in this browser, never loader data; the editor mounts when opened",
    },
  ],
  [
    "src/components/placement/column-mapping.tsx: useState(() => wideDraft(initial && fitToDataset(initial, dataset).wide))",
    {
      class: "D",
      why: "the wide reading being edited (#736), from the column mapping stored in this browser, never loader data; the editor mounts when opened and remounts for a new file",
    },
  ],
  [
    "src/components/placement/download-as.tsx: useState(STANDARD_OPTION)",
    {
      class: "D",
      why: "the Download as choice, a module constant to start; staff's own choice in component state, never loader data",
    },
  ],
  [
    "src/components/comment-thread.tsx: useState(comment.content)",
    {
      class: "D",
      why: "comments are read through `useQuery` in ProjectPrivatePanel, since the detail loader carries none, and opening an edit resets the draft from the saved text",
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
    "src/components/placement/results-tab.tsx: useState({at, open: NO_FOLDS})",
    {
      class: "D",
      why: "which board projects were folded by hand, in component state, for the run whose time it holds; a new run starts over",
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
      why: "the proposer record the staff panel reads through `useQuery`, not loader data; its query never refetches under the draft",
    },
  ],
  [
    "src/components/staff-proposer-section.tsx: useState(proposer.studentProposed)",
    {
      class: "D",
      why: "the proposer record the staff panel reads through `useQuery`, not loader data; its query never refetches under the draft",
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

const HOOKS = new Set(["useState", "useRef", "useReducer"]);
const UNCONTROLLED = new Set(["defaultValue", "defaultChecked"]);

function parse(path: string, source = readFileSync(path, "utf8")) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** `node` and every node under it, in source order. */
function descendants(node: ts.Node, into: ts.Node[] = []): ts.Node[] {
  into.push(node);
  ts.forEachChild(node, (child) => {
    descendants(child, into);
  });
  return into;
}

/** A name as written, or `undefined` for a computed one. */
function nameOf(name: ts.Node): string | undefined {
  return ts.isIdentifier(name) ||
    ts.isStringLiteralLike(name) ||
    ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

type Property = ts.PropertyAssignment | ts.ShorthandPropertyAssignment;

function isProperty(node: ts.Node): node is Property {
  return (
    ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)
  );
}

/** What a property sets: `{ a: b }` sets `b`, and `{ a }` sets `a`. */
function propertyValue(property: Property): ts.Expression {
  return ts.isPropertyAssignment(property)
    ? property.initializer
    : property.name;
}

/** The value of every object literal property called `name` in `file`. */
function propertyValues(file: ts.SourceFile, name: string): ts.Expression[] {
  return descendants(file)
    .filter(isProperty)
    .filter((property) => nameOf(property.name) === name)
    .map(propertyValue);
}

/** A string, number, boolean, `null`, `undefined`, or a negative number. */
function isPrimitive(node: ts.Expression): boolean {
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === "undefined") ||
    (ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.MinusToken &&
      ts.isNumericLiteral(node.operand))
  );
}

/** `new Set()` or `new Map()`, with type arguments or without. */
function isEmptyCollection(node: ts.Expression): boolean {
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (node.expression.text === "Set" || node.expression.text === "Map") &&
    (node.arguments?.length ?? 0) === 0
  );
}

/**
 * A plain literal, which cannot carry loader data: a primitive, an empty
 * `Set` or `Map`, an arrow with no parameters whose body is one, or an array
 * or object built only from them, with no spread and no computed key; any of
 * those may be in parentheses, or under `as`, `as const` or `satisfies`.
 * Everything else is a seed somebody has to classify.
 */
function isLiteral(node: ts.Expression): boolean {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    return isLiteral(node.expression);
  }
  if (ts.isArrowFunction(node)) {
    return (
      node.parameters.length === 0 &&
      !ts.isBlock(node.body) &&
      isLiteral(node.body)
    );
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.every(isLiteral);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every(
      (property) =>
        ts.isPropertyAssignment(property) &&
        nameOf(property.name) !== undefined &&
        isLiteral(property.initializer)
    );
  }
  return isPrimitive(node) || isEmptyCollection(node);
}

interface Seed {
  /** Every argument that seeds, which is more than one only for `useReducer`. */
  init: readonly ts.Expression[];
  kind: string;
}

/** `useState(x)` or `React.useState(x)`, and the same for the other hooks. */
function hookSeed(call: ts.CallExpression): Seed | undefined {
  const callee = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : call.expression;
  const kind = nameOf(callee);
  if (kind === undefined || !HOOKS.has(kind)) {
    return;
  }
  // `useReducer(reducer, initialArg, init?)`: the reducer is not a seed.
  return { init: call.arguments.slice(kind === "useReducer" ? 1 : 0), kind };
}

/** `<Input defaultValue={x} />`; a bare `defaultChecked` is a literal `true`. */
function attributeSeed(attribute: ts.JsxAttribute): Seed | undefined {
  const kind = nameOf(attribute.name);
  const value = attribute.initializer;
  const init = value && ts.isJsxExpression(value) ? value.expression : value;
  if (kind === undefined || !UNCONTROLLED.has(kind) || init === undefined) {
    return;
  }
  return { init: [init], kind };
}

/**
 * Whether a JSX spread spreads `object`: `{...{ a }}`, and the same object in
 * parentheses, under `as` or `satisfies`, as a branch of a `?:`, or as an
 * operand of `&&`, `||` or `??`.
 */
function isSpreadOntoElement(object: ts.Node): boolean {
  let node = object.parent;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isConditionalExpression(node) ||
    ts.isBinaryExpression(node)
  ) {
    node = node.parent;
  }
  return ts.isJsxSpreadAttribute(node);
}

/**
 * A form's `defaultValues`, or an uncontrolled input's default written in an
 * object literal spread onto the element: `<Input {...{ defaultValue: x }} />`.
 */
function propertySeed(property: Property): Seed | undefined {
  const kind = nameOf(property.name);
  const spreadOntoInput =
    kind !== undefined &&
    UNCONTROLLED.has(kind) &&
    isSpreadOntoElement(property.parent);
  if (kind !== "defaultValues" && !spreadOntoInput) {
    return;
  }
  return { init: [propertyValue(property)], kind };
}

function seedAt(node: ts.Node): Seed | undefined {
  if (ts.isCallExpression(node)) {
    return hookSeed(node);
  }
  if (ts.isJsxAttribute(node)) {
    return attributeSeed(node);
  }
  if (isProperty(node)) {
    return propertySeed(node);
  }
}

/** One line, no padding inside brackets, no trailing comma: Biome's wrap undone. */
function normalize(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .replace(/([([{]) /gu, "$1")
    .replace(/,? ?([)\]}])/gu, "$1")
    .trim();
}

function label({ init, kind }: Seed, file: ts.SourceFile): string {
  if (kind === "defaultValues") {
    return kind;
  }
  const text = file.text.slice(init[0].getStart(file), init.at(-1)?.end);
  return `${kind}(${normalize(text)})`;
}

/** The label of every once-only initializer in `file` that is not a plain literal. */
function onceOnlySeeds(file: ts.SourceFile): string[] {
  const labels: string[] = [];
  for (const node of descendants(file)) {
    const seed = seedAt(node);
    // `every` holds on no arguments, so `useState()` is not a seed either.
    if (seed && !seed.init.every(isLiteral)) {
      labels.push(label(seed, file));
    }
  }
  return labels;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== TEST_DIR && entry.name !== "__tests__") {
        yield* sourceFiles(path);
      }
    } else if (/\.tsx?$/u.test(entry.name) && !entry.name.includes(".test.")) {
      yield path;
    }
  }
}

function treeSeeds(): Set<string> {
  const found = new Set<string>();
  for (const path of sourceFiles(SRC_DIR)) {
    const file = relative(process.cwd(), path);
    for (const seed of onceOnlySeeds(parse(path))) {
      found.add(`${file}: ${seed}`);
    }
  }
  return found;
}

function labelsIn(source: string): string[] {
  return onceOnlySeeds(parse("fixture.tsx", source));
}

/** An initializer's source, and whether the scan should call it a seed. */
interface Generated {
  seeds: boolean;
  text: string;
}

const literal = (text: string): Generated => ({ seeds: false, text });
const nonLiteral = (text: string): Generated => ({ seeds: true, text });

/**
 * Initializers built from the grammar `isLiteral` accepts, nested and wrapped,
 * with a non-literal sometimes put in at any depth: a read, a call, a spread
 * or a computed key. One of them anywhere makes the whole a seed, the
 * direction in which a mistake would drop a seed without a red test.
 */
const initializers = fc.letrec<{ init: Generated }>((tie) => {
  const inner = tie("init");
  const wrap = (shape: (text: string) => string, seeds?: boolean) =>
    inner.map((init) => ({
      seeds: seeds ?? init.seeds,
      text: shape(init.text),
    }));
  const list = (shape: (texts: string[]) => string) =>
    fc.array(inner, { maxLength: 3 }).map((inits) => ({
      seeds: inits.some((init) => init.seeds),
      text: shape(inits.map((init) => init.text)),
    }));
  return {
    init: fc.oneof(
      { depthSize: "small", maxDepth: 3 },
      fc.oneof(
        trickyText({ maxLength: 4 }).map((text) =>
          literal(JSON.stringify(text))
        ),
        fc.integer().map((n) => literal(String(n))),
        fc
          .constantFrom(
            "true",
            "false",
            "null",
            "undefined",
            "1.5",
            "0x1f",
            "1_000",
            "`text`",
            "new Set()",
            "new Map<string, number>()"
          )
          .map(literal),
        fc
          .constantFrom("data.x", "load()", "-data.x", "new Set(rows)")
          .map(nonLiteral)
      ),
      list((texts) => `[${texts.join(", ")}]`),
      list(
        (texts) => `{ ${texts.map((text, i) => `k${i}: ${text}`).join(", ")} }`
      ),
      wrap((text) => `() => (${text})`),
      wrap((text) => `(${text}) as const`),
      wrap((text) => `(${text}) satisfies Row`),
      // A spread or a computed key seeds, whatever it holds.
      wrap((text) => `[...${text}]`, true),
      wrap((text) => `{ [key]: ${text} }`, true)
    ),
  };
}).init;

describe("once-only seeds", () => {
  it("are all in the census, and the census has none left over", () => {
    const found = treeSeeds();
    const unclassified = [...found].filter((site) => !CENSUS.has(site)).sort();
    expect(
      unclassified,
      "A once-only initializer that is not a plain literal is not in the\n" +
        "census. It is read at mount (a form's until a field is touched), so\n" +
        "one seeded from loader data keeps whatever frame it mounted on. Read\n" +
        "the classes in the comment above `SeedClass` in\n" +
        "src/test/loader-seed-scan.test.ts, then classify each site below as\n" +
        "A, B, C or D in CENSUS there, with the reason. A site whose\n" +
        "initializer was edited appears here under its new text; move its\n" +
        "entry.\n\n" +
        unclassified.join("\n")
    ).toEqual([]);

    // The other direction: a site that is gone should lose its entry, so
    // the census cannot grow stale.
    const stale = [...CENSUS.keys()].filter((site) => !found.has(site)).sort();
    expect(
      stale,
      "These CENSUS entries match nothing in src/. Remove them.\n\n" +
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

  it("finds a lazy initializer whole, nested calls and all", () => {
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

  it("finds a hook called on a namespace and a default spread from an object literal", () => {
    expect(
      labelsIn(`
        const [x] = React.useState(data.x);
        <Input {...{ defaultValue: data.y }} />
        <Checkbox {...{ defaultChecked: false }} />
        <Input {...({ defaultValue: data.z } as InputProps)} />
        <Checkbox {...(open ? { defaultChecked: data.on } : {})} />
        <Input {...(editing && { defaultValue: data.w })} />
        <Input {...props} />
      `)
    ).toEqual([
      "useState(data.x)",
      "defaultValue(data.y)",
      "defaultValue(data.z)",
      "defaultChecked(data.on)",
      "defaultValue(data.w)",
    ]);
  });

  it("skips plain literals and comments", () => {
    expect(
      labelsIn(`
        const [open] = useState(false);
        const [error] = useState<string | null>(null);
        const [draft] = useState("");
        const [offset] = useState(-1);
        const [rows] = useState<Row[]>([]);
        const [picked] = useState(() => new Set<string>());
        const [byId] = useState(new Map());
        const [paging] = useState(() => ({ page: 1, size: undefined }));
        const [filters] = useState({ page: 1, q: "" } as const);
        const [tabs] = useState(["a", \`b\`] satisfies Tab[]);
        const inputRef = useRef<HTMLInputElement>(null);
        const [unset] = useState();
        const [step] = useState(
          // Where the flow starts.
          "address"
        );
        // useState(record.name) in a comment is prose.
        /**
         * So is useState(record.name) in a docstring.
         */
        /* seed */ const [a] = useState(record.x);
        {/* Name */}<Input defaultValue={user.name} />
        const [rows2] = useState([] as Row[] && loaderData.rows);
        const [vals] = useState({} as Partial<V> && loaderData.v as Partial<V>);
        const [name] = useState([] as Tuple<S> + loaderData.name as Tuple<S>);
      `)
    ).toEqual([
      "useState(record.x)",
      "defaultValue(user.name)",
      "useState([] as Row[] && loaderData.rows)",
      "useState({} as Partial<V> && loaderData.v as Partial<V>)",
      "useState([] as Tuple<S> + loaderData.name as Tuple<S>)",
    ]);
  });

  it("reads a spread, a computed key or a shorthand as a seed", () => {
    expect(
      labelsIn(`
        const [a] = useState([...base]);
        const [b] = useState({ [key]: 1 });
        const [c] = useState({ page });
      `)
    ).toEqual([
      "useState([...base])",
      "useState({[key]: 1})",
      "useState({page})",
    ]);
  });

  test.prop([initializers])(
    "reads an initializer as a seed exactly when some part is not a literal",
    ({ seeds, text }) => {
      expect(labelsIn(`useState(${text});`)).toEqual(
        seeds ? [`useState(${normalize(text)})`] : []
      );
    }
  );
});

/**
 * The option the census rests on. Class A is correct only while a stale
 * revisit blocks, so reverting the router default, or opting one route out,
 * silently changes what every class A seed means. Both read the syntax tree,
 * so a commented-out line counts for nothing.
 */
describe("the stale reload mode the census rests on", () => {
  const remedy =
    "ADR-0029's class A seeds are correct only while a stale revisit\n" +
    "blocks. Before changing this, apply the remedy in\n" +
    "docs/adr/0029-a-revisit-waits-for-its-loader.md to every class A seed\n" +
    "the change reaches, and reclassify them in CENSUS.";

  it("is blocking by default, in src/router.tsx", () => {
    const modes = propertyValues(
      parse(join(SRC_DIR, "router.tsx")),
      "defaultStaleReloadMode"
    );
    expect(
      modes.length > 0 &&
        modes.every(
          (mode) => ts.isStringLiteralLike(mode) && mode.text === "blocking"
        ),
      `src/router.tsx no longer sets defaultStaleReloadMode: "blocking".\n${remedy}`
    ).toBe(true);
  });

  it("is not overridden by any route's loader", () => {
    // All of src/, not only src/routes: a loader object built elsewhere and
    // spread into a route carries its staleReloadMode with it. Any identifier
    // or string naming it counts, so an assignment or `loader["..."]` does too.
    const overrides = [...sourceFiles(SRC_DIR)]
      .filter((path) =>
        descendants(parse(path)).some(
          (node) => nameOf(node) === "staleReloadMode"
        )
      )
      .map((path) => relative(process.cwd(), path))
      .sort();
    expect(
      overrides,
      `These files set staleReloadMode on a loader.\n${remedy}\n\n` +
        overrides.join("\n")
    ).toEqual([]);
  });
});

function isZero(node: ts.Expression): boolean {
  return ts.isNumericLiteral(node) && node.text === "0";
}

/** The route id a route file passes to `createFileRoute`. */
function routeIdOf(file: ts.SourceFile): string | undefined {
  const call = descendants(file).find(
    (node): node is ts.CallExpression =>
      ts.isCallExpression(node) && nameOf(node.expression) === "createFileRoute"
  );
  const id = call?.arguments[0];
  return id && ts.isStringLiteralLike(id) ? id.text : undefined;
}

/**
 * A click reuses a preload for the route's `preloadStaleTime`, so a page that
 * keeps one can mount on a frame that old, which the blocking reload above
 * does not cover. ADR-0062 allows the window only on a page that seeds no form
 * from its loader (#762).
 *
 * This matches on the prose of each census reason, not on data flow, so it
 * catches a new row whose reason names such a page, not a seed written
 * without one.
 */
describe("the preload window ADR-0062 allows", () => {
  it("is off by default, in src/router.tsx", () => {
    const windows = propertyValues(
      parse(join(SRC_DIR, "router.tsx")),
      "defaultPreloadStaleTime"
    );
    expect(
      windows.length > 0 && windows.every(isZero),
      "src/router.tsx no longer sets defaultPreloadStaleTime: 0, which opts\n" +
        "every route into a preload window. ADR-0062 allows one only on a page\n" +
        "that seeds no form from its loader; set it per route instead."
    ).toBe(true);
  });

  it("is kept only by a route whose page no census reason names", () => {
    const named: string[] = [];
    for (const path of sourceFiles(join(SRC_DIR, "routes"))) {
      const file = parse(path);
      // Any value but a literal zero counts, so a named constant is a window.
      const keeps = propertyValues(file, "preloadStaleTime").some(
        (window) => !isZero(window)
      );
      const routeId = routeIdOf(file);
      if (!keeps || routeId === undefined) {
        continue;
      }
      // `/_public/projects/` is the page at `/projects`: no pathless layout
      // is part of the URL a census reason names, nor is the slash.
      const page =
        routeId.replace(/^(?:\/_[^/]+)+/u, "").replace(/\/$/u, "") || "/";
      const escaped = page.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      // Bounded on both sides: `/projects` is not named by
      // `/admin/projects` nor by `/projects/$projectId/edit`.
      const names = new RegExp(`(?<![\\w/$])${escaped}(?![\\w/$])`, "u");
      for (const [site, { why }] of CENSUS) {
        if (names.test(why)) {
          named.push(`${relative(process.cwd(), path)} (${page}): ${site}`);
        }
      }
    }
    expect(
      named,
      "These routes keep a preload (preloadStaleTime above zero), and a\n" +
        "CENSUS reason says their page seeds from its loader. ADR-0062 allows\n" +
        "one or the other. Drop the route's preloadStaleTime, or make the seed\n" +
        "load its own record, as StaffProgramSection does.\n\n" +
        named.join("\n")
    ).toEqual([]);
  });
});
