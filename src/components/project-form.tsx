import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { applyServerErrors } from "#/lib/apply-server-errors";
import type {
  FieldSuggestion,
  ImprovableField,
} from "#/lib/project-review-fields";
import { reviewProject } from "#/server/project-review";
import { CategoryMultiSelect } from "./category-multi-select";
import { ProgramSelect } from "./program-select";
import { ProjectImageUploader } from "./project-image-uploader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const optionalUrl = z
  .union([z.literal(""), z.string().url("Must be a valid URL").max(500)])
  .default("");

const optionalEmail = z
  .union([z.literal(""), z.string().email("Must be a valid email").max(200)])
  .default("");

const optionalUuid = z
  .union([z.literal(""), z.string().uuid("Must be a UUID")])
  .default("");

export const projectFormSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(5000).default(""),
  problemStatement: z.string().max(5000).default(""),
  objectives: z.string().max(5000).default(""),
  minQualifications: z.string().max(2000).default(""),
  prefQualifications: z.string().max(2000).default(""),
  url: optionalUrl,
  contactEmail: optionalEmail,
  contactName: z.string().max(200).default(""),
  imageUrl: z.union([z.literal(""), z.string().max(500)]).default(""),
  licenseRestrictions: z.string().max(1000).default(""),
  programId: optionalUuid,
  notes: z.string().max(5000).default(""),
});

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

type Props = {
  initial?: Partial<ProjectFormValues>;
  initialCategoryIds?: string[];
  showNotes: boolean;
  showCategories: boolean;
  submitLabel: string;
  onSubmit: (
    values: ProjectFormValues,
    categoryIds: string[],
    pendingImage: File | null,
  ) => Promise<unknown>;
  enableAiReview?: boolean;
  projectId?: string;
};

export function ProjectForm({
  initial,
  initialCategoryIds,
  showNotes,
  showCategories,
  submitLabel,
  onSubmit,
  enableAiReview,
  projectId,
}: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryIds, setCategoryIds] = useState<string[]>(
    initialCategoryIds ?? [],
  );
  // `undefined`: user did not touch the image. `File`: new file to upload on
  // submit. `null`: user clicked Remove, server should clear the image.
  const [pendingImage, setPendingImage] = useState<File | null | undefined>(
    undefined,
  );
  const [suggestions, setSuggestions] = useState<
    Partial<Record<ImprovableField, FieldSuggestion>>
  >({});
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "empty">(
    "idle",
  );
  const [reviewError, setReviewError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      title: initial?.title ?? "",
      description: initial?.description ?? "",
      problemStatement: initial?.problemStatement ?? "",
      objectives: initial?.objectives ?? "",
      minQualifications: initial?.minQualifications ?? "",
      prefQualifications: initial?.prefQualifications ?? "",
      url: initial?.url ?? "",
      contactEmail: initial?.contactEmail ?? "",
      contactName: initial?.contactName ?? "",
      imageUrl: initial?.imageUrl ?? "",
      licenseRestrictions: initial?.licenseRestrictions ?? "",
      programId: initial?.programId ?? "",
      notes: initial?.notes ?? "",
    } satisfies ProjectFormValues,
    validators: {
      onSubmit: ({ value }) => {
        const result = projectFormSchema.safeParse(value);
        if (result.success) return undefined;
        const fields: Record<string, string> = {};
        for (const issue of result.error.issues) {
          const key = issue.path.join(".");
          if (key && !fields[key]) fields[key] = issue.message;
        }
        return { fields };
      },
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      try {
        await onSubmit(value, categoryIds, pendingImage ?? null);
      } catch (err) {
        const handled = applyServerErrors(
          form as unknown as Parameters<typeof applyServerErrors>[0],
          err,
        );
        if (!handled) {
          setFormError((err as Error)?.message || "Save failed");
        }
      }
    },
  });

  async function handleReview() {
    if (!projectId) return;
    setReviewError(null);
    setReviewState("loading");
    try {
      const v = form.state.values;
      const result = await reviewProject({
        data: {
          projectId,
          fields: {
            title: v.title,
            description: v.description,
            problemStatement: v.problemStatement,
            objectives: v.objectives,
            minQualifications: v.minQualifications,
            prefQualifications: v.prefQualifications,
            licenseRestrictions: v.licenseRestrictions,
          },
        },
      });
      setSuggestions(result.suggestions);
      setReviewState(result.reviewedFields.length === 0 ? "empty" : "idle");
    } catch (err) {
      setReviewError((err as Error)?.message || "AI review failed");
      setReviewState("idle");
    }
  }

  function applyField(field: ImprovableField) {
    const s = suggestions[field];
    if (!s) return;
    form.setFieldValue(field as never, s.suggestion as never);
    setSuggestions((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function applyAll() {
    for (const field of Object.keys(suggestions) as ImprovableField[]) {
      const s = suggestions[field];
      if (s) form.setFieldValue(field as never, s.suggestion as never);
    }
    setSuggestions({});
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      {enableAiReview && (
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Improve with AI</p>
              <p className="text-xs text-muted-foreground">
                Suggests rewrites for the text fields. You review and apply each
                change.
              </p>
            </div>
            <div className="flex gap-2">
              {Object.keys(suggestions).length > 0 && (
                <Button type="button" variant="outline" onClick={applyAll}>
                  Apply all
                </Button>
              )}
              <Button
                type="button"
                onClick={handleReview}
                disabled={reviewState === "loading"}
              >
                {reviewState === "loading" ? "Reviewing..." : "Review with AI"}
              </Button>
            </div>
          </div>
          {reviewError && (
            <p className="mt-2 text-sm text-destructive">{reviewError}</p>
          )}
          {reviewState === "empty" && (
            <p className="mt-2 text-sm text-muted-foreground">
              No improvements suggested.
            </p>
          )}
        </div>
      )}
      <Field
        form={form}
        name="title"
        label="Title"
        suggestion={suggestions.title}
        onApply={() => applyField("title")}
      />
      <Field
        form={form}
        name="description"
        label="Description"
        textarea
        rows={4}
        suggestion={suggestions.description}
        onApply={() => applyField("description")}
      />
      <Field
        form={form}
        name="problemStatement"
        label="Problem statement"
        textarea
        rows={3}
        suggestion={suggestions.problemStatement}
        onApply={() => applyField("problemStatement")}
      />
      <Field
        form={form}
        name="objectives"
        label="Objectives / deliverables"
        textarea
        rows={3}
        suggestion={suggestions.objectives}
        onApply={() => applyField("objectives")}
      />
      <Field
        form={form}
        name="minQualifications"
        label="Minimum qualifications"
        textarea
        rows={2}
        suggestion={suggestions.minQualifications}
        onApply={() => applyField("minQualifications")}
      />
      <Field
        form={form}
        name="prefQualifications"
        label="Preferred qualifications"
        textarea
        rows={2}
        suggestion={suggestions.prefQualifications}
        onApply={() => applyField("prefQualifications")}
      />
      <Field form={form} name="url" label="URL" placeholder="https://..." />
      <Field form={form} name="contactName" label="Contact name" />
      <Field
        form={form}
        name="contactEmail"
        label="Contact email"
        placeholder="name@example.com"
      />
      <form.Field name="imageUrl">
        {(field: AnyForm) => (
          <div>
            <Label>Image</Label>
            <div className="mt-1">
              <ProjectImageUploader
                currentKey={(field.state.value as string) || null}
                onChange={(file) => {
                  setPendingImage(file);
                  if (file === null) field.handleChange("");
                }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Cropped to 16:9 and resized to max 1600x900. Saved when you submit
              the form.
            </p>
          </div>
        )}
      </form.Field>
      <Field
        form={form}
        name="licenseRestrictions"
        label="License / IP restrictions"
        textarea
        rows={2}
        suggestion={suggestions.licenseRestrictions}
        onApply={() => applyField("licenseRestrictions")}
      />
      <form.Field name="programId">
        {(field: AnyForm) => (
          <div>
            <Label htmlFor="programId">Program</Label>
            <ProgramSelect
              id="programId"
              value={field.state.value as string}
              onChange={(v) => field.handleChange(v)}
            />
          </div>
        )}
      </form.Field>
      {showNotes && (
        <Field
          form={form}
          name="notes"
          label="Internal notes (staff only)"
          textarea
          rows={3}
        />
      )}
      {showCategories && (
        <div>
          <Label>Categories</Label>
          <div className="mt-1">
            <CategoryMultiSelect
              value={categoryIds}
              onChange={setCategoryIds}
            />
          </div>
        </div>
      )}

      {formError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <Button type="submit" disabled={!canSubmit}>
            {isSubmitting ? "Saving..." : submitLabel}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics are unstable; field name comes from schema
type AnyForm = any;

type FieldProps = {
  form: AnyForm;
  name: keyof ProjectFormValues;
  label: string;
  placeholder?: string;
  textarea?: boolean;
  rows?: number;
  suggestion?: FieldSuggestion;
  onApply?: () => void;
};

function Field({
  form,
  name,
  label,
  placeholder,
  textarea,
  rows,
  suggestion,
  onApply,
}: FieldProps) {
  return (
    <form.Field name={name as never}>
      {(field: AnyForm) => (
        <div>
          <Label htmlFor={field.name}>{label}</Label>
          {textarea ? (
            <Textarea
              id={field.name}
              name={field.name}
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              rows={rows}
              placeholder={placeholder}
              className="mt-1"
            />
          ) : (
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder={placeholder}
              className="mt-1"
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="mt-1 text-sm text-destructive">
              {field.state.meta.errors
                .map((e: unknown) =>
                  typeof e === "string"
                    ? e
                    : ((e as { message?: string })?.message ?? String(e)),
                )
                .join(", ")}
            </p>
          )}
          {suggestion && (
            <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <p className="text-xs font-medium text-primary">
                Suggested change
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {suggestion.suggestion}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {suggestion.rationale}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={onApply}
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      )}
    </form.Field>
  );
}
