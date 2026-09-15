import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useId } from "react";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
import { FilterSwitch } from "./filter-switch";
import { SearchHint } from "./search-hint";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
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

export type ProjectsOrder = "relevance" | "newest" | "recommended";

/**
 * The switch labels, one line each under the legend "Only show projects that
 * are". Shared with `/admin/projects`, which carries three of the four under
 * the same params (#340), so the two listings cannot drift apart and the
 * accessibility tests name one string. The two mentor switches left with
 * the mentor state (#402).
 */
export const PROJECT_SWITCH_LABEL = {
  acceptingOnly: "Accepting applicants",
  archivedOnly: "Archived",
  requiresNdaOnly: "Requiring an NDA or IP agreement",
  // The same string as the badge, so the filter and the mark read as one
  // fact (#372).
  studentProposedOnly: "Student proposed",
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
    state.acceptingOnly,
    state.archivedOnly,
    state.studentProposedOnly,
    state.requiresNdaOnly,
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
          acceptingOnly: false,
          archivedOnly: false,
          studentProposedOnly: false,
          requiresNdaOnly: false,
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
        fields="titles, descriptions, problem statements, objectives and qualifications"
        id={hintId}
      />
      <Select onValueChange={(v) => setOrder(v as ProjectsOrder)} value={order}>
        <SelectTrigger aria-label="Sort" className="w-44" id="filter-sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="relevance">Most relevant</SelectItem>
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem disabled={!canRecommend} value="recommended">
            Recommended for you
          </SelectItem>
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
 * the aside from `xl` and in the sheet below it. The switch labels are one
 * line each under a legend that carries the "only show" so that each fits
 * an 18rem column beside its switch; the full sentence wrapped to two lines.
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
        <legend className="font-medium text-muted-foreground text-xs">
          Only show projects that are
        </legend>
        <div className="mt-1">
          <FilterSwitch
            checked={acceptingOnly}
            id={`${uid}-accepting-only`}
            label={PROJECT_SWITCH_LABEL.acceptingOnly}
            onCheckedChange={(v) => setFilter("acceptingOnly", v)}
          />
          <FilterSwitch
            checked={archivedOnly}
            id={`${uid}-archived-only`}
            label={PROJECT_SWITCH_LABEL.archivedOnly}
            onCheckedChange={(v) => setFilter("archivedOnly", v)}
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

      {active > 0 && (
        <Button
          className="h-auto p-0"
          onClick={clearAll}
          type="button"
          variant="link"
        >
          Clear all
        </Button>
      )}
    </div>
  );
}
