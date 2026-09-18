import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useId } from "react";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
import { ClearFiltersButton } from "./clear-filters-button";
import { FilterSwitch } from "./filter-switch";
import { SearchHint } from "./search-hint";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { ViewToggle } from "./view-toggle";

export interface FilterCategory {
  id: string;
  name: string;
  type: string;
}
export interface FilterProgram {
  courseId: string;
  courseName: string;
  id: string;
}

export type ProjectsOrder =
  | "relevance"
  | "newest"
  | "oldest"
  | "title"
  | "updated"
  | "recommended";

/**
 * The listing's one ordering control, in the order the select offers them.
 *
 * Since #475 this is the only thing that orders the public listing: the
 * table's column headers no longer sort, so a reader in either view sees the
 * same rows in the same order for the same URL. The options that replaced the
 * headers are here rather than on the columns, which is why Title and
 * Recently updated read as sentences rather than as column names.
 *
 * Contact name and Contact email stay table columns and are deliberately not
 * here: ordering a public catalog by a contact's surname is a staff shaped
 * job, and #476 made them searchable instead.
 */
export const PROJECT_ORDER_LABEL: Record<ProjectsOrder, string> = {
  recommended: "Recommended for you",
  relevance: "Most relevant",
  newest: "Newest",
  oldest: "Oldest",
  title: "Title A-Z",
  updated: "Recently updated",
};

/**
 * The legend over the narrowing switches. Each label below completes it as
 * one sentence, lowercase, so a reader hears "Only show projects that are
 * looking for team members" (#383). Shared with `/admin/projects`, which renders
 * the same three switches under the same params (#340) plus one of its own,
 * so the two listings cannot drift apart and the accessibility tests name
 * one string.
 */
export const PROJECT_SWITCH_LEGEND = "Only show projects that";

/**
 * The switch labels, one line each under the legend. Archive is not here:
 * it swaps the set rather than narrowing it, so it is the "Show" radio
 * above the switches (#383). The two mentor switches left with the mentor
 * state (#402).
 */
export const PROJECT_SWITCH_LABEL = {
  acceptingOnly: "are looking for team members",
  requiresNdaOnly: "require an NDA or IP agreement",
  studentProposedOnly: "were proposed by a student",
} as const;

/**
 * The line under a switch whose label alone does not say what the other
 * position does. Only this one has one, and it matters more now that the
 * public listing turns it on by default (#419): a student who never touches
 * the switch should still be able to find out that there are more projects
 * behind it. Keyed like the labels so the admin page shows it too, where the
 * default is off and the sentence reads the same way.
 */
export const PROJECT_SWITCH_HINT: Partial<
  Record<keyof typeof PROJECT_SWITCH_LABEL, string>
> = {
  acceptingOnly: "Turn off to also show projects whose team is full.",
};

/**
 * The archive mode (#383): "Current projects" or "Archived projects", over
 * the existing `archivedOnly` param so pasted links keep working. A radio
 * rather than a switch because it swaps the set (`status = archived` in
 * place of `published`) while every switch ANDs a condition onto it, and a
 * switch under "Only show" read as if archived projects were in the default
 * set.
 */
export const ARCHIVE_MODE_LABEL = {
  current: "Current projects",
  archived: "Archived projects",
} as const;

export const ARCHIVE_MODE_HINT =
  "Archived projects ran in a past term and no longer take teams.";

/**
 * What `/projects` shows a visitor who has touched nothing.
 *
 * `acceptingOnly` is the one that is not `false`: a student opening the
 * listing is looking for a project to join, and half a first page they cannot
 * join is worse than a switch they have to find (#419). `/admin/projects`
 * keeps its own `SWITCH_DEFAULTS`, where every switch is off, because staff
 * want the whole set.
 *
 * One source for three readers: the route's `searchSchema`, `clearAll` below,
 * and `countActiveFilters`, which is what stops an untouched visit reporting
 * itself as narrowed.
 */
export const PROJECTS_FILTER_DEFAULTS = {
  acceptingOnly: true,
  archivedOnly: false,
  requiresNdaOnly: false,
  studentProposedOnly: false,
} as const;

/** The narrowing params of `/projects`, as the route's search carries them. */
export interface ProjectsFilterState {
  acceptingOnly: boolean;
  archivedOnly: boolean;
  categories: string[];
  program: string | null;
  requiresNdaOnly: boolean;
  studentProposedOnly: boolean;
}

/**
 * How many narrowing filters are on, for the Filters button below `xl`. A
 * category set counts once however many it holds: it is one decision.
 */
export function countActiveFilters(state: ProjectsFilterState): number {
  return [
    state.program !== null,
    state.categories.length > 0,
    // Against the default, not against `false`. `acceptingOnly` defaults on,
    // so counting truth would make every untouched visit report one filter
    // and offer a Clear that changes nothing (#419).
    state.acceptingOnly !== PROJECTS_FILTER_DEFAULTS.acceptingOnly,
    state.archivedOnly !== PROJECTS_FILTER_DEFAULTS.archivedOnly,
    state.studentProposedOnly !== PROJECTS_FILTER_DEFAULTS.studentProposedOnly,
    state.requiresNdaOnly !== PROJECTS_FILTER_DEFAULTS.requiresNdaOnly,
  ].filter(Boolean).length;
}

/**
 * The navigations the search row and the filters share. Every change goes
 * back to page one, because the page number stops meaning anything once the
 * set of matching rows changes.
 */
function useProjectsFilterNavigation() {
  const navigate = useNavigate({ from: "/projects/" });
  const commitQuery = useCallback(
    (next: string) => {
      void navigate({
        search: (prev) => ({ ...prev, q: next, page: 1 }),
      });
    },
    [navigate]
  );
  return {
    commitQuery,
    setFilter<K extends keyof ProjectsFilterState>(
      key: K,
      value: ProjectsFilterState[K]
    ) {
      void navigate({
        search: (prev) => ({ ...prev, [key]: value, page: 1 }),
      });
    },
    setOrder(value: ProjectsOrder) {
      void navigate({ search: (prev) => ({ ...prev, order: value, page: 1 }) });
    },
    setView(next: ViewMode) {
      void navigate({ search: (prev) => ({ ...prev, view: next }) });
    },
    clearAll() {
      void navigate({
        search: (prev) => ({
          ...prev,
          categories: [],
          program: null,
          ...PROJECTS_FILTER_DEFAULTS,
          page: 1,
        }),
      });
    },
  };
}

interface SearchProps {
  /**
   * Whether the viewer has an interests vector, as the route loader read it
   * from `searchProjects`. From the loader rather than an effect so the first
   * paint is already right: an effect started at `false` and painted the
   * "Add your interests" prompt for everyone, members with interests and
   * visitors alike, until the answer came back (#321).
   */
  canRecommend: boolean;
  order: ProjectsOrder;
  q: string;
  /** Same source as `canRecommend`, and for the same reason. */
  signedIn: boolean;
  view: ViewMode;
}

/**
 * The top of the listing at every width: the search, the server order and
 * the card/table toggle. None of these narrows the list, which is why they
 * stay beside the Filters button rather than inside the aside.
 */
export function ProjectsSearchBar({
  canRecommend,
  order,
  q,
  view,
}: Omit<SearchProps, "signedIn">) {
  const { commitQuery, setOrder, setView } = useProjectsFilterNavigation();
  const [queryDraft, setQueryDraft] = useDebouncedDraft(q, commitQuery);
  // `useId` rather than a literal: the bar mounts once, so a literal would
  // work, but the hint is this component's own and nothing outside needs
  // the id. The admin routes render input and hint inline and keep a
  // literal beside the literal `id` their sr-only Label already points at.
  const hintId = useId();
  return (
    <>
      <Input
        aria-describedby={hintId}
        aria-label="Search projects"
        // basis-40 where the other three inputs carry basis-64: this is the
        // one row with a sort select, a view toggle, Filters and Columns
        // beside the input, and at 768 in table view it is 767px of basis
        // in a 704px row with basis-64, so Columns wrapped. At 160px the
        // row fits with room to spare, and flex-1 grows the input back.
        className="min-w-0 flex-1 basis-40"
        onChange={(e) => setQueryDraft(e.target.value)}
        // A name for the box, not its documentation: the row gives it about
        // 28 characters at 768 in table view, and the fields and the syntax
        // are on the hint line under it (#369).
        placeholder="Search projects"
        type="search"
        value={queryDraft}
      />
      <SearchHint
        // Contacts are last because they are the narrowest of the six and the
        // most recent (#476); the rest keep the order the tsvector weights
        // them in.
        fields="titles, descriptions, problem statements, objectives, qualifications and contacts"
        id={hintId}
        // The committed query, not `queryDraft`: the note describes the
        // search that ran, so it must not appear and vanish between
        // keystrokes, the same reason "Most relevant" is gated on `q` below.
        query={q}
      />
      <Select onValueChange={(v) => setOrder(v as ProjectsOrder)} value={order}>
        {/*
          w-52 because "Recommended for you" needs 146px at text-sm, and the
          trigger spends 50px before the value gets any: 24 px-3, 8 gap-2, 16
          chevron, 2 border (the easy term to forget). So w-44 left 126 and
          clipped it through SelectValue's line-clamp-1; w-52 leaves 158. It
          is a fixed 208px at 375 as well as at desktop, never flex-sized, so
          one width covers both. It costs the row its last slack at 768 in table view,
          where the five controls now end exactly where the row does. See
          #454, and the input's basis-40 for the budget this spent.
        */}
        <SelectTrigger aria-label="Sort" className="w-52" id="filter-sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {/*
            "Most relevant" is absent rather than disabled while the box is
            empty, because with no query it is not a different ordering: it
            resolves to Newest on the server, and an option that silently
            means another one is worse than no option (#475). Gated on the
            committed `q` rather than on the draft, so it does not appear and
            vanish between keystrokes.

            "Recommended for you" is disabled rather than absent, because it
            is a thing the reader could have: the prompt under this row tells
            them how, and an option that is simply gone tells them nothing.
          */}
          <SelectItem disabled={!canRecommend} value="recommended">
            {PROJECT_ORDER_LABEL.recommended}
          </SelectItem>
          {q.trim() !== "" && (
            <SelectItem value="relevance">
              {PROJECT_ORDER_LABEL.relevance}
            </SelectItem>
          )}
          <SelectItem value="newest">{PROJECT_ORDER_LABEL.newest}</SelectItem>
          <SelectItem value="oldest">{PROJECT_ORDER_LABEL.oldest}</SelectItem>
          <SelectItem value="title">{PROJECT_ORDER_LABEL.title}</SelectItem>
          <SelectItem value="updated">{PROJECT_ORDER_LABEL.updated}</SelectItem>
        </SelectContent>
      </Select>
      <ViewToggle current={view} onChange={setView} />
    </>
  );
}

/**
 * The line under the search row about recommendations. Rendered by the route
 * as the first thing in the results column, not inside `ProjectsSearchBar`:
 * the search row is a flex-wrap row that ends with ListingLayout's Filters
 * button, and a paragraph in the middle of it put the prompt's link between
 * the view toggle and that button in the tab order. `pl-3` for the same
 * reason as `SearchHint`: both line up with the input's text, and from `md`
 * they are adjacent lines under the row.
 */
export function RecommendationPrompt({
  canRecommend,
  order,
  signedIn,
}: Pick<SearchProps, "canRecommend" | "order" | "signedIn">) {
  return (
    <>
      {order === "recommended" && canRecommend && (
        <p className="mt-2 pl-3 text-muted-foreground text-xs">
          Ranked by your interests.{" "}
          <Link className="text-brand-dark underline" to="/profile">
            Edit your interests
          </Link>
        </p>
      )}
      {/*
        Three states, one line each. A visitor is sent to sign in and back
        here, not to /profile, which would bounce them to sign-in with the
        profile as the return address. A member with no vector is sent to
        write their interests. A member with one gets no prompt.
      */}
      {!(canRecommend || signedIn) && (
        <p className="mt-2 pl-3 text-muted-foreground text-xs">
          <Link
            className="text-brand-dark underline"
            search={{ redirect: "/projects" }}
            to="/sign-in"
          >
            Sign in to get recommendations
          </Link>{" "}
          sorted by how well projects match your interests.
        </p>
      )}
      {signedIn && !canRecommend && (
        <p className="mt-2 pl-3 text-muted-foreground text-xs">
          <Link className="text-brand-dark underline" to="/profile">
            Add your interests
          </Link>{" "}
          to sort projects by how well they match you.
        </p>
      )}
    </>
  );
}

interface FiltersProps extends ProjectsFilterState {
  allCategories: FilterCategory[];
  allPrograms: FilterProgram[];
}

/**
 * The narrowing controls, stacked for a column: `ListingLayout` puts them in
 * the aside from `xl` and in the sheet below it. The archive radio comes
 * first, outside the "Only show" fieldset, since it picks the set the
 * switches then narrow. The switch labels are one line each under a legend
 * that carries the "only show" so that each fits an 18rem column beside its
 * switch; the full sentence wrapped to two lines.
 */
export function ProjectsFilters({
  acceptingOnly,
  allCategories,
  allPrograms,
  archivedOnly,
  categories,
  program,
  requiresNdaOnly,
  studentProposedOnly,
}: FiltersProps) {
  const { clearAll, setFilter } = useProjectsFilterNavigation();
  // ListingLayout mounts this form twice, in the aside and in the sheet, so
  // a literal id would be duplicated and every label would resolve to the
  // hidden aside copy. useId gives each mount its own set.
  const uid = useId();

  function toggleCategory(id: string) {
    setFilter(
      "categories",
      categories.includes(id)
        ? categories.filter((c) => c !== id)
        : [...categories, id]
    );
  }

  const grouped = new Map<string, FilterCategory[]>();
  for (const c of allCategories) {
    const arr = grouped.get(c.type) ?? [];
    arr.push(c);
    grouped.set(c.type, arr);
  }

  const active = countActiveFilters({
    acceptingOnly,
    archivedOnly,
    categories,
    program,
    requiresNdaOnly,
    studentProposedOnly,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-program`}>Program</Label>
        <Select
          onValueChange={(v) => setFilter("program", v === "_all_" ? null : v)}
          value={program ?? "_all_"}
        >
          <SelectTrigger className="w-full" id={`${uid}-program`}>
            <SelectValue placeholder="All programs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All programs</SelectItem>
            {allPrograms.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.courseId} {p.courseName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset>
        {/*
          The legend names the fieldset, not the radiogroup inside it, so the
          group points at it by id for its own accessible name.
        */}
        <legend
          className="font-medium text-muted-foreground text-xs"
          id={`${uid}-archive-legend`}
        >
          Show
        </legend>
        <RadioGroup
          aria-describedby={`${uid}-archive-hint`}
          aria-labelledby={`${uid}-archive-legend`}
          className="mt-1 gap-1"
          onValueChange={(v) => setFilter("archivedOnly", v === "archived")}
          value={archivedOnly ? "archived" : "current"}
        >
          {(["current", "archived"] as const).map((mode) => (
            <Label className="min-h-7 font-normal" key={mode}>
              <RadioGroupItem value={mode} />
              {ARCHIVE_MODE_LABEL[mode]}
            </Label>
          ))}
        </RadioGroup>
        <p
          className="mt-1 text-muted-foreground text-xs"
          id={`${uid}-archive-hint`}
        >
          {ARCHIVE_MODE_HINT}
        </p>
      </fieldset>

      <fieldset>
        <legend className="font-medium text-muted-foreground text-xs">
          {PROJECT_SWITCH_LEGEND}
        </legend>
        <div className="mt-1">
          <FilterSwitch
            checked={acceptingOnly}
            hint={PROJECT_SWITCH_HINT.acceptingOnly}
            id={`${uid}-accepting-only`}
            label={PROJECT_SWITCH_LABEL.acceptingOnly}
            onCheckedChange={(v) => setFilter("acceptingOnly", v)}
          />
          <FilterSwitch
            checked={studentProposedOnly}
            id={`${uid}-student-proposed-only`}
            label={PROJECT_SWITCH_LABEL.studentProposedOnly}
            onCheckedChange={(v) => setFilter("studentProposedOnly", v)}
          />
          <FilterSwitch
            checked={requiresNdaOnly}
            id={`${uid}-requires-nda-only`}
            label={PROJECT_SWITCH_LABEL.requiresNdaOnly}
            onCheckedChange={(v) => setFilter("requiresNdaOnly", v)}
          />
        </div>
      </fieldset>

      {grouped.size > 0 && (
        <fieldset>
          <legend className="font-medium text-muted-foreground text-xs">
            Categories (matches all selected)
          </legend>
          <div className="mt-1 space-y-2">
            {[...grouped.entries()].map(([type, items]) => (
              <div key={type}>
                <p className="text-muted-foreground text-xs">{type}</p>
                <div className="mt-1 space-y-1">
                  {items.map((c) => (
                    <Label className="min-h-7 font-normal" key={c.id}>
                      <Checkbox
                        checked={categories.includes(c.id)}
                        onCheckedChange={() => toggleCategory(c.id)}
                      />
                      {c.name}
                    </Label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
      )}

      {active > 0 && <ClearFiltersButton onClick={clearAll} />}
    </div>
  );
}
