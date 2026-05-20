import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { applyServerErrors } from "#/lib/apply-server-errors";
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
};

export function ProjectForm({
  initial,
  initialCategoryIds,
  showNotes,
  showCategories,
  submitLabel,
  onSubmit,
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

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      <Field form={form} name="title" label="Title" />
      <Field
        form={form}
        name="description"
        label="Description"
        textarea
        rows={4}
      />
      <Field
        form={form}
        name="problemStatement"
        label="Problem statement"
        textarea
        rows={3}
      />
      <Field
        form={form}
        name="objectives"
        label="Objectives / deliverables"
        textarea
        rows={3}
      />
      <Field
        form={form}
        name="minQualifications"
        label="Minimum qualifications"
        textarea
        rows={2}
      />
      <Field
        form={form}
        name="prefQualifications"
        label="Preferred qualifications"
        textarea
        rows={2}
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
};

function Field({ form, name, label, placeholder, textarea, rows }: FieldProps) {
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
        </div>
      )}
    </form.Field>
  );
}
