import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import {
  listProjectCategories,
  setProjectCategories,
} from "#/server/categories";
import { CategoryMultiSelect } from "./category-multi-select";
import { PanelSection } from "./panel";
import { Button } from "./ui/button";

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
  onChanged: () => void;
  projectId: string;
}) {
  const [saved, setSaved] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { rows } = await listProjectCategories({ data: { projectId } });
      const ids = rows.map((c) => c.id);
      setSaved(ids);
      setDraft(ids);
    } catch (e) {
      setError(errorMessage(e, "Could not load the categories"));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setProjectCategories({
        data: { projectId, categoryIds: draft },
      });
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Save failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelSection title="Categories">
      <div className="space-y-3">
        <CategoryMultiSelect
          domain="project"
          onChange={setDraft}
          value={draft}
        />
        {error && <p className="text-destructive text-sm">{error}</p>}
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
