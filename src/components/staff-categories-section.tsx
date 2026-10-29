import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "#/lib/error-message";
import {
  DRAFT_QUERY_OPTIONS,
  refetchAfterSave,
  staffProjectKeys,
  staffRead,
  useSeedOnArrival,
} from "#/lib/staff-project-queries";
import { useAction } from "#/lib/use-action";
import {
  listProjectCategories,
  setProjectCategories,
} from "#/server/categories";
import { CategoryMultiSelect } from "./category-multi-select";
import { PanelSection } from "./panel";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";

/**
 * The staff edit of a project's categories, as a section of the staff panel
 * (#322). `setProjectCategories` was already a standalone staff-only write
 * with its own seam; only the control moved here from the form.
 *
 * Save is disabled until the saved list has arrived: the draft starts empty,
 * and posting an empty draft over a real list would clear every category and
 * look like a decision. The write is unconditional once it has, because
 * clearing every category is a thing staff can mean.
 */
export function StaffCategoriesSection({
  onChanged,
  projectId,
}: {
  onChanged: () => Promise<void>;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const queryKey = staffProjectKeys.categories(projectId);
  const saved = useQuery({
    queryKey,
    queryFn: () =>
      staffRead(async () => {
        const { rows } = await listProjectCategories({ data: { projectId } });
        return rows.map((c) => c.id);
      }),
    ...DRAFT_QUERY_OPTIONS,
  });
  const [draft, setDraft] = useState<string[]>([]);
  useSeedOnArrival(projectId, saved.data, setDraft);
  // A second activation in the same tick would write the category set twice;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  const { busy, error, run } = useAction({ fallback: "Save failed" });
  const loadError =
    saved.data === undefined && saved.isError
      ? errorMessage(saved.error, "Could not load the categories")
      : null;

  function save() {
    return run(async () => {
      await setProjectCategories({
        data: { projectId, categoryIds: draft },
      });
      const fresh = await refetchAfterSave<string[]>(
        queryClient,
        projectId,
        queryKey,
        onChanged
      );
      setDraft(fresh);
    });
  }

  return (
    <PanelSection title="Categories">
      <div className="space-y-3">
        <CategoryMultiSelect
          domain="project"
          onChange={setDraft}
          value={draft}
        />
        <FieldError message={error ?? loadError} />
        <Button
          disabled={busy || saved.data === undefined}
          onClick={() => void save()}
          size="sm"
          type="button"
        >
          {busy ? "Saving..." : "Save categories"}
        </Button>
      </div>
    </PanelSection>
  );
}
