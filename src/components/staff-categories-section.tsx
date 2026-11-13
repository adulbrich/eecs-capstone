import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { CategoryProposal } from "#/lib/categorize";
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  KIND_OF_WORK_TYPE,
} from "#/lib/default-categories";
import { errorMessage } from "#/lib/error-message";
import {
  DRAFT_QUERY_OPTIONS,
  refetchAfterSave,
  STAFF_READ_OPTIONS,
  staffProjectKeys,
  staffRead,
  useSeedOnArrival,
} from "#/lib/staff-project-queries";
import { useAction } from "#/lib/use-action";
import {
  approveProposedCategory,
  getProjectCategorization,
  listCategoryTypes,
  listProjectCategories,
  regenerateProjectCategories,
  setProjectCategories,
} from "#/server/categories";
import { AttemptFailed, triggerPhrase } from "./ai-attempt";
import { CategoryMultiSelect, categoriesQuery } from "./category-multi-select";
import { LocalTime } from "./local-time";
import { PanelSection } from "./panel";
import { Button } from "./ui/button";
import { FieldError, SavedNote } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Textarea } from "./ui/textarea";

const SUPERSEDED =
  "These categories changed while the model was working, so nothing was replaced. Regenerate again to replace them.";

/**
 * The staff edit of a project's categories, as a section of the staff panel
 * (#322), and the categorizer's controls (#31).
 *
 * Save is disabled until the saved list has arrived: the draft starts empty,
 * and posting an empty draft over a real list would clear every category and
 * look like a decision. The write is unconditional once it has, because
 * clearing every category is a thing staff can mean.
 *
 * Regenerate replaces the saved categories with the model's picks and reseeds
 * the draft from them, which discards unsaved picker changes; the sentence
 * under the buttons says so. Approving a proposed category adds it to the
 * draft as well as to the project, so unsaved changes survive that one.
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
  const statusKey = staffProjectKeys.categorization(projectId);
  const saved = useQuery({
    queryKey,
    queryFn: () =>
      staffRead(async () => {
        const { rows } = await listProjectCategories({ data: { projectId } });
        return rows.map((c) => c.id);
      }),
    ...DRAFT_QUERY_OPTIONS,
  });
  const status = useQuery({
    queryKey: statusKey,
    queryFn: () =>
      staffRead(() => getProjectCategorization({ data: { projectId } })),
    ...STAFF_READ_OPTIONS,
  });
  const [draft, setDraft] = useState<string[]>([]);
  useSeedOnArrival(projectId, saved.data, setDraft);
  const [proposal, setProposal] = useState<CategoryProposal | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // One action for both writes, so Save and Regenerate can never run at once;
  // `use-action.ts` says why the hook's ref is what stops a double activation
  // (#443).
  const { busy, error, run } = useAction({ fallback: "Save failed" });
  const [running, setRunning] = useState<"save" | "regenerate" | null>(null);
  const loadError =
    saved.data === undefined && saved.isError
      ? errorMessage(saved.error, "Could not load the categories")
      : null;
  const regenerable = status.data?.regenerable ?? false;
  const attempt = status.data?.attempt;

  function save() {
    setRunning("save");
    return run(async () => {
      setNotice(null);
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

  function regenerate() {
    setRunning("regenerate");
    return run(async () => {
      setNotice(null);
      setProposal(null);
      const result = await regenerateProjectCategories({
        data: { projectId },
      });
      queryClient.setQueryData(statusKey, {
        attempt: result.attempt,
        regenerable: result.regenerable,
      });
      const fresh = await refetchAfterSave<string[]>(
        queryClient,
        projectId,
        queryKey,
        onChanged
      );
      setDraft(fresh);
      setProposal(result.proposal);
      if (result.outcome === "superseded") {
        setNotice(SUPERSEDED);
      }
    }, "Could not regenerate the categories");
  }

  async function approved(categoryId: string) {
    setProposal(null);
    setDraft((current) =>
      current.includes(categoryId) ? current : [...current, categoryId]
    );
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: categoriesQuery("project").queryKey,
      }),
      queryClient.invalidateQueries({ queryKey }),
      onChanged(),
    ]);
  }

  return (
    <PanelSection title="Categories">
      <div className="space-y-3">
        {attempt?.outcome === "failed" && saved.data?.length === 0 && (
          <AttemptFailed>
            Categorizing failed {triggerPhrase(attempt.trigger, "Regenerate")},{" "}
            <LocalTime value={attempt.at} />. Regenerate to try again, or pick
            them below.
          </AttemptFailed>
        )}
        <CategoryMultiSelect
          domain="project"
          onChange={setDraft}
          value={draft}
        />
        <FieldError message={error ?? loadError} />
        <FieldError message={notice} />
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || saved.data === undefined}
            onClick={() => void save()}
            size="sm"
            type="button"
          >
            {busy && running === "save" ? "Saving..." : "Save categories"}
          </Button>
          <Button
            disabled={busy || !regenerable}
            onClick={() => void regenerate()}
            size="sm"
            type="button"
            variant="outline"
          >
            {busy && running === "regenerate"
              ? "Regenerating..."
              : "Regenerate categories"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {status.data && !regenerable
            ? "Restore the project to regenerate its categories."
            : "Regenerate replaces the saved categories, and any unsaved changes here, with AI picks from the project's current text. It counts toward your AI limit."}
        </p>
        {proposal && (
          <ProposedCategory
            key={`${proposal.type}|${proposal.name}`}
            onApproved={approved}
            onDismiss={() => setProposal(null)}
            projectId={projectId}
            proposal={proposal}
          />
        )}
      </div>
    </PanelSection>
  );
}

/**
 * A category the model proposed on Regenerate, as a form staff can edit and
 * approve (#31). Never stored: Dismiss and leaving the page both drop it, and
 * Approve is the only write. The type is a select of the existing types other
 * than Kind of work, the same rule the server checks.
 */
function ProposedCategory({
  onApproved,
  onDismiss,
  projectId,
  proposal,
}: {
  onApproved: (categoryId: string) => Promise<void>;
  onDismiss: () => void;
  projectId: string;
  proposal: CategoryProposal;
}) {
  const id = useId();
  const [name, setName] = useState(proposal.name);
  const [type, setType] = useState(proposal.type);
  const [description, setDescription] = useState(proposal.description);
  const types = useQuery({
    queryKey: ["category-types"],
    queryFn: async () => (await listCategoryTypes()).types,
    ...STAFF_READ_OPTIONS,
  });
  const typeOptions = (types.data ?? [proposal.type]).filter(
    (t) => t !== KIND_OF_WORK_TYPE
  );
  const { busy, error, run } = useAction({
    fallback: "Could not add the category",
  });
  const [added, setAdded] = useState<string | null>(null);

  function approve() {
    return run(async () => {
      const result = await approveProposedCategory({
        data: { projectId, name, type, description },
      });
      setAdded(`Added "${name}" to ${type} and to this project.`);
      await onApproved(result.categoryId);
    });
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-3 rounded-md border p-3"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-medium" id={`${id}-title`}>
          Suggested new category
        </h3>
        <p className="text-muted-foreground text-sm">{proposal.reason}</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-type`}>Type</Label>
        <Select onValueChange={setType} value={type}>
          <SelectTrigger className="w-full" id={`${id}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeOptions.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-name`}>Name</Label>
        <Input
          id={`${id}-name`}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          value={name}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-description`}>Description</Label>
        <Textarea
          id={`${id}-description`}
          maxLength={CATEGORY_DESCRIPTION_MAX_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
          value={description}
        />
      </div>
      <FieldError message={error} />
      <SavedNote message={added} />
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !name.trim()}
          onClick={() => void approve()}
          size="sm"
          type="button"
        >
          {busy ? "Adding..." : "Approve and add"}
        </Button>
        <Button
          disabled={busy}
          onClick={onDismiss}
          size="sm"
          type="button"
          variant="outline"
        >
          Dismiss
        </Button>
      </div>
    </section>
  );
}
