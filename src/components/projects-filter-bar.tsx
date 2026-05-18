import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listCategories } from "#/server/categories";
import { listPrograms } from "#/server/programs";

type Category = { id: string; name: string; type: string };
type Program = { id: string; courseId: string; courseName: string };

type Props = {
  q: string;
  categories: string[];
  program: string | null;
};

export function ProjectsFilterBar({ q, categories, program }: Props) {
  const navigate = useNavigate({ from: "/projects/" });
  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [allPrograms, setAllPrograms] = useState<Program[]>([]);
  const [queryDraft, setQueryDraft] = useState(q);

  useEffect(() => {
    void (async () => {
      try {
        const [{ rows: cats }, { rows: progs }] = await Promise.all([
          listCategories({ data: {} }),
          listPrograms(),
        ]);
        setAllCategories(cats as Category[]);
        setAllPrograms(progs as Program[]);
      } catch {
        // ignored
      }
    })();
  }, []);

  useEffect(() => setQueryDraft(q), [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (queryDraft !== q) {
        void navigate({
          search: (prev) => ({ ...prev, q: queryDraft, page: 1 }),
        });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [queryDraft, q, navigate]);

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

  function clearAll() {
    void navigate({
      search: () => ({ q: "", categories: [], program: null, page: 1 }),
    });
  }

  const grouped = new Map<string, Category[]>();
  for (const c of allCategories) {
    const arr = grouped.get(c.type) ?? [];
    arr.push(c);
    grouped.set(c.type, arr);
  }

  const hasAnyFilter = q || categories.length > 0 || program;

  return (
    <div className="border border-neutral-200 p-4 dark:border-neutral-800">
      <input
        type="search"
        value={queryDraft}
        onChange={(e) => setQueryDraft(e.target.value)}
        placeholder='Search projects (try "phrase" or -word to exclude)'
        className="w-full border p-2"
      />

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <label
            htmlFor="filter-program"
            className="block text-xs font-medium text-neutral-500"
          >
            Program
          </label>
          <select
            id="filter-program"
            value={program ?? ""}
            onChange={(e) => setProgram(e.target.value)}
            className="mt-1 w-full border bg-white p-2 dark:bg-neutral-900"
          >
            <option value="">All programs</option>
            {allPrograms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.courseId} {p.courseName}
              </option>
            ))}
          </select>
        </div>
      </div>

      {grouped.size > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-neutral-500">Categories</p>
          <div className="mt-1 space-y-2">
            {[...grouped.entries()].map(([type, items]) => (
              <div key={type}>
                <p className="text-xs text-neutral-400">{type}</p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {items.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-1 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={categories.includes(c.id)}
                        onChange={() => toggleCategory(c.id)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasAnyFilter && (
        <button
          type="button"
          onClick={clearAll}
          className="mt-3 text-sm text-blue-700 hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
