import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
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
  const [saved, setSaved] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  // A second activation in the same tick would write the category set twice;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  // `setError` comes back out for the load below, which writes its failure
  // into the same slot.
  const { busy, error, run, setError } = useAction({ fallback: "Save failed" });

  const load = useCallback(async () => {
    try {
      const { rows } = await listProjectCategories({ data: { projectId } });
      const ids = rows.map((c) => c.id);
      setSaved(ids);
      setDraft(ids);
    } catch (e) {
      setError(errorMessage(e, "Could not load the categories"));
    }
    // `setError` is the hook's own state setter, so it is stable and the
    // dependency costs nothing; Biome cannot see that from here.
  }, [projectId, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  function save() {
    return run(async () => {
      await setProjectCategories({
        data: { projectId, categoryIds: draft },
      });
      await load();
      await onChanged();
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
        <FieldError message={error} />
        <Button
          disabled={busy || saved === null}
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
