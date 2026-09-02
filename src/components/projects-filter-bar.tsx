import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import type { ViewMode } from "#/lib/view-preference";
import { listCategories, type listSchema } from "#/server/categories";
import { getMyInterests } from "#/server/interests";
import { listPrograms } from "#/server/programs";
import { FilterSwitch } from "./filter-switch";
import { Card } from "./ui/card";
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

interface Category {
  id: string;
  name: string;
  type: string;
}
interface Program {
  courseId: string;
  courseName: string;
  id: string;
}

interface Props {
  archivedOnly: boolean;
  categories: string[];
  order: "relevance" | "newest" | "recommended";
  program: string | null;
  q: string;
  view: ViewMode;
}

export function ProjectsFilterBar({
  q,
  categories,
  program,
  archivedOnly,
  order,
  view,
}: Props) {
  const navigate = useNavigate({ from: "/projects/" });
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [allPrograms, setAllPrograms] = useState<Program[]>([]);
  const [canRecommend, setCanRecommend] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const listData = {
          domain: "project",
        } satisfies z.input<typeof listSchema>;
        const [{ rows: cats }, { rows: progs }] = await Promise.all([
          listCategories({ data: listData }),
          listPrograms(),
        ]);
        setAllCategories(cats as Category[]);
        setAllPrograms(progs as Program[]);
      } catch {
        // ignored
      }
      try {
        const interests = await getMyInterests();
        setCanRecommend(interests.hasEmbedding);
      } catch {
        // Signed out, or the call failed: the option stays disabled.
      }
    })();
  }, []);

  const commitQuery = useCallback(
    (next: string) => {
      void navigate({
        search: (prev) => ({ ...prev, q: next, page: 1 }),
      });
    },
    [navigate]
  );
  const [queryDraft, setQueryDraft] = useDebouncedDraft(q, commitQuery);

  function toggleCategory(id: string) {
    const next = categories.includes(id)
      ? categories.filter((c) => c !== id)
      : [...categories, id];
    void navigate({
      search: (prev) => ({ ...prev, categories: next, page: 1 }),
    });
  }

  function setProgram(value: string) {
    void navigate({
      search: (prev) => ({ ...prev, program: value || null, page: 1 }),
    });
  }

  function setOrder(value: "relevance" | "newest" | "recommended") {
    void navigate({ search: (prev) => ({ ...prev, order: value, page: 1 }) });
  }

  function clearAll() {
    void navigate({
      search: (prev) => ({
        ...prev,
        q: "",
        categories: [],
        program: null,
        archivedOnly: false,
        order: "relevance",
        page: 1,
      }),
    });
  }

  function setArchivedOnly(value: boolean) {
    void navigate({
      search: (prev) => ({ ...prev, archivedOnly: value, page: 1 }),
    });
  }

  const grouped = new Map<string, Category[]>();
  for (const c of allCategories) {
    const arr = grouped.get(c.type) ?? [];
    arr.push(c);
    grouped.set(c.type, arr);
  }

  const hasAnyFilter =
    q ||
    categories.length > 0 ||
    program ||
    archivedOnly ||
    order !== "relevance";

  return (
    <Card className="bg-transparent p-4">
      <div className="flex items-center gap-3">
        <Input
          aria-label="Search projects"
          className="flex-1"
          onChange={(e) => setQueryDraft(e.target.value)}
          placeholder='Search projects (try "phrase" or -word to exclude)'
          type="search"
          value={queryDraft}
        />
        <ViewToggle current={view} />
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div>
          <Label htmlFor="filter-program">Program</Label>
          <Select
            onValueChange={(v) => setProgram(v === "_all_" ? "" : v)}
            value={program ?? "_all_"}
          >
            <SelectTrigger className="mt-1 w-full" id="filter-program">
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
        <div>
          <Label htmlFor="filter-sort">Sort</Label>
          <Select
            onValueChange={(v) =>
              setOrder(v as "relevance" | "newest" | "recommended")
            }
            value={order}
          >
            <SelectTrigger className="mt-1 w-full" id="filter-sort">
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
        </div>
        <div className="flex items-end">
          <FilterSwitch
            checked={archivedOnly}
            id="filter-archived-only"
            label="Show only archived projects"
            onCheckedChange={setArchivedOnly}
          />
        </div>
      </div>

      {order === "recommended" && canRecommend && (
        <p className="mt-2 text-muted-foreground text-xs">
          Ranked by your interests.{" "}
          <Link className="text-brand hover:underline" to="/profile">
            Edit your interests
          </Link>
        </p>
      )}
      {!canRecommend && (
        <p className="mt-2 text-muted-foreground text-xs">
          <Link className="text-brand hover:underline" to="/profile">
            Add your interests
          </Link>{" "}
          to sort projects by how well they match you.
        </p>
      )}

      {grouped.size > 0 && (
        <div className="mt-3">
          <p className="font-medium text-muted-foreground text-xs">
            Categories
          </p>
          <div className="mt-1 space-y-2">
            {[...grouped.entries()].map(([type, items]) => (
              <div key={type}>
                <p className="text-muted-foreground text-xs">{type}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {items.map((c) => (
                    <Label className="font-normal" key={c.id}>
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
        </div>
      )}

      {hasAnyFilter && (
        <button
          className="mt-3 text-brand text-sm outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={clearAll}
          type="button"
        >
          Clear all
        </button>
      )}
    </Card>
  );
}
