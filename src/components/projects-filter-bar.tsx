import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
import { FilterSwitch } from "./filter-switch";
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

/** The narrowing params of `/projects`, as the route's search carries them. */
export interface ProjectsFilterState {
  acceptingOnly: boolean;
  archivedOnly: boolean;
  categories: string[];
  program: string | null;
  seekingMentorOnly: boolean;
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
    state.seekingMentorOnly,
  ].filter(Boolean).length;
}

/**
 * The navigations the two halves of the bar share. Every change goes back to
 * page one, because the page number stops meaning anything once the set of
 * matching rows changes.
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
          seekingMentorOnly: false,
          page: 1,
        }),
      });
    },
  };
}

interface SearchBarProps {
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
  signedIn,
  view,
}: SearchBarProps) {
  const { commitQuery, setOrder, setView } = useProjectsFilterNavigation();
  const [queryDraft, setQueryDraft] = useDebouncedDraft(q, commitQuery);
  return (
    <>
      <Input
        aria-label="Search projects"
        className="min-w-0 flex-1 basis-64"
        onChange={(e) => setQueryDraft(e.target.value)}
        placeholder='Search projects (try "phrase" or -word to exclude)'
        type="search"
        value={queryDraft}
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
      {order === "recommended" && canRecommend && (
        <p className="basis-full text-muted-foreground text-xs">
          Ranked by your interests.{" "}
          <Link className="text-brand hover:underline" to="/profile">
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
        <p className="basis-full text-muted-foreground text-xs">
          <Link
            className="text-brand hover:underline"
            search={{ redirect: "/projects" }}
            to="/sign-in"
          >
            Sign in to get recommendations
          </Link>{" "}
          sorted by how well projects match your interests.
        </p>
      )}
      {signedIn && !canRecommend && (
        <p className="basis-full text-muted-foreground text-xs">
          <Link className="text-brand hover:underline" to="/profile">
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
 * a 18rem column beside its switch; the full sentence wrapped to two lines.
 */
export function ProjectsFilters({
  acceptingOnly,
  allCategories,
  allPrograms,
  archivedOnly,
  categories,
  program,
  seekingMentorOnly,
  studentProposedOnly,
}: FiltersProps) {
  const { clearAll, setFilter } = useProjectsFilterNavigation();

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
    seekingMentorOnly,
    studentProposedOnly,
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="filter-program">Program</Label>
        <Select
          onValueChange={(v) => setFilter("program", v === "_all_" ? null : v)}
          value={program ?? "_all_"}
        >
          <SelectTrigger className="w-full" id="filter-program">
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
            id="filter-accepting-only"
            label="Accepting applicants"
            onCheckedChange={(v) => setFilter("acceptingOnly", v)}
          />
          <FilterSwitch
            checked={archivedOnly}
            id="filter-archived-only"
            label="Archived"
            onCheckedChange={(v) => setFilter("archivedOnly", v)}
          />
          <FilterSwitch
            checked={studentProposedOnly}
            id="filter-student-proposed-only"
            label="Student-proposed"
            onCheckedChange={(v) => setFilter("studentProposedOnly", v)}
          />
          <FilterSwitch
            checked={seekingMentorOnly}
            id="filter-seeking-mentor-only"
            label="Seeking a mentor"
            onCheckedChange={(v) => setFilter("seekingMentorOnly", v)}
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
        <button
          className="text-brand text-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={clearAll}
          type="button"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
