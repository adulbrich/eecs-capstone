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

interface Props {
  enableAiReview?: boolean;
  initial?: Partial<ProjectFormValues>;
  initialCategoryIds?: string[];
  onSubmit: (
    values: ProjectFormValues,
    categoryIds: string[],
    pendingImage: File | null
  ) => Promise<unknown>;
  projectId?: string;
  showCategories: boolean;
  showNotes: boolean;
  submitLabel: string;
}

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
    initialCategoryIds ?? []
  );
  // `undefined`: user did not touch the image. `File`: new file to upload on
  // submit. `null`: user clicked Remove, server should clear the image.
  const [pendingImage, setPendingImage] = useState<File | null | undefined>(
    undefined
  );
  const [suggestions, setSuggestions] = useState<
    Partial<Record<ImprovableField, FieldSuggestion>>
  >({});
  const [reviewState, setReviewState] = useState<"idle" | "loading" | "empty">(
    "idle"
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
        if (result.success) {
          return;
        }
        const fields: Record<string, string> = {};
        for (const issue of result.error.issues) {
          const key = issue.path.join(".");
          if (key && !fields[key]) {
            fields[key] = issue.message;
          }
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
          err
        );
        if (!handled) {
          setFormError((err as Error)?.message || "Save failed");
        }
      }
    },
  });

  async function handleReview() {
    // The edit route always supplies projectId; guard for the future
    // new-project path where the button could appear before a project exists.
    if (!projectId) {
      return;
    }
    setReviewError(null);
    setReviewState("loading");
    // Clear any prior suggestions so a fresh review never shows stale ones.
    setSuggestions({});
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
      // Key the empty state off what we will actually render, not the server's
      // reviewedFields list, so the message is correct even if they diverge.
      setReviewState(
        Object.keys(result.suggestions).length === 0 ? "empty" : "idle"
      );
    } catch (err) {
      setReviewError((err as Error)?.message || "AI review failed");
      setReviewState("idle");
    }
  }

  // setFieldValue is the supported way to write a named field from outside its
  // form.Field render prop; validation runs on submit, so bypassing the
  // per-field onChange pipeline here is intentional and harmless.
  function applyField(field: ImprovableField) {
    const s = suggestions[field];
    if (!s) {
      return;
    }
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
      if (s) {
        form.setFieldValue(field as never, s.suggestion as never);
      }
    }
    setSuggestions({});
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        void form.handleSubmit();
      }}
    >
      {enableAiReview && (
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-medium text-sm">Improve with AI</p>
              <p className="text-muted-foreground text-xs">
                Suggests rewrites for the text fields. You review and apply each
                change.
              </p>
            </div>
            <div className="flex gap-2">
              {Object.keys(suggestions).length > 0 && (
                <Button onClick={applyAll} type="button" variant="outline">
                  Apply all
                </Button>
              )}
              <Button
                disabled={reviewState === "loading"}
                onClick={handleReview}
                type="button"
              >
                {reviewState === "loading" ? "Reviewing..." : "Review with AI"}
              </Button>
            </div>
          </div>
          <output className="block">
            {reviewError && (
              <p className="mt-2 text-destructive text-sm">{reviewError}</p>
            )}
            {reviewState === "empty" && (
              <p className="mt-2 text-muted-foreground text-sm">
                No improvements suggested.
              </p>
            )}
          </output>
        </div>
      )}
      <Field
        form={form}
        label="Title"
        name="title"
        onApply={() => applyField("title")}
        suggestion={suggestions.title}
      />
      <Field
        form={form}
        label="Description"
        name="description"
        onApply={() => applyField("description")}
        rows={4}
        suggestion={suggestions.description}
        textarea
      />
      <Field
        form={form}
        label="Problem statement"
        name="problemStatement"
        onApply={() => applyField("problemStatement")}
        rows={3}
        suggestion={suggestions.problemStatement}
        textarea
      />
      <Field
        form={form}
        label="Objectives / deliverables"
        name="objectives"
        onApply={() => applyField("objectives")}
        rows={3}
        suggestion={suggestions.objectives}
        textarea
      />
      <Field
        form={form}
        label="Minimum qualifications"
        name="minQualifications"
        onApply={() => applyField("minQualifications")}
        rows={2}
        suggestion={suggestions.minQualifications}
        textarea
      />
      <Field
        form={form}
        label="Preferred qualifications"
        name="prefQualifications"
        onApply={() => applyField("prefQualifications")}
        rows={2}
        suggestion={suggestions.prefQualifications}
        textarea
      />
      <Field form={form} label="URL" name="url" placeholder="https://..." />
      <Field form={form} label="Contact name" name="contactName" />
      <Field
        form={form}
        label="Contact email"
        name="contactEmail"
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
                  if (file === null) {
                    field.handleChange("");
                  }
                }}
              />
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              Cropped to 16:9 and resized to max 1600x900. Saved when you submit
              the form.
            </p>
          </div>
        )}
      </form.Field>
      <Field
        form={form}
        label="License / IP restrictions"
        name="licenseRestrictions"
        onApply={() => applyField("licenseRestrictions")}
        rows={2}
        suggestion={suggestions.licenseRestrictions}
        textarea
      />
      <form.Field name="programId">
        {(field: AnyForm) => (
          <div>
            <Label htmlFor="programId">Program</Label>
            <ProgramSelect
              id="programId"
              onChange={(v) => field.handleChange(v)}
              value={field.state.value as string}
            />
          </div>
        )}
      </form.Field>
      {showNotes && (
        <Field
          form={form}
          label="Internal notes (staff only)"
          name="notes"
          rows={3}
          textarea
        />
      )}
      {showCategories && (
        <div>
          <Label>Categories</Label>
          <div className="mt-1">
            <CategoryMultiSelect
              onChange={setCategoryIds}
              value={categoryIds}
            />
          </div>
        </div>
      )}

      {formError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
          {formError}
        </div>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <Button disabled={!canSubmit} type="submit">
            {isSubmitting ? "Saving..." : submitLabel}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics are unstable; field name comes from schema
type AnyForm = any;

interface FieldProps {
  form: AnyForm;
  label: string;
  name: keyof ProjectFormValues;
  onApply?: () => void;
  placeholder?: string;
  rows?: number;
  suggestion?: FieldSuggestion;
  textarea?: boolean;
}

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
              className="mt-1"
              id={field.name}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={placeholder}
              rows={rows}
              value={field.state.value as string}
            />
          ) : (
            <Input
              className="mt-1"
              id={field.name}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={placeholder}
              value={field.state.value as string}
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="mt-1 text-destructive text-sm">
              {field.state.meta.errors
                .map((e: unknown) =>
                  typeof e === "string"
                    ? e
                    : ((e as { message?: string })?.message ?? String(e))
                )
                .join(", ")}
            </p>
          )}
          {suggestion && (
            <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2">
              <p className="font-medium text-primary text-xs">
                Suggested change
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {suggestion.suggestion}
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                {suggestion.rationale}
              </p>
              <Button
                aria-label={`Apply suggestion for ${label}`}
                className="mt-2"
                onClick={onApply}
                size="sm"
                type="button"
                variant="outline"
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
