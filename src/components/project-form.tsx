import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { applyServerErrors } from "#/lib/apply-server-errors";
import { CategoryMultiSelect } from "./category-multi-select";
import { ProgramSelect } from "./program-select";
import { ProjectImageUploader } from "./project-image-uploader";

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
  projectId: string;
  initial?: Partial<ProjectFormValues>;
  initialCategoryIds?: string[];
  showNotes: boolean;
  showCategories: boolean;
  submitLabel: string;
  onSubmit: (
    values: ProjectFormValues,
    categoryIds: string[],
  ) => Promise<unknown>;
};

export function ProjectForm({
  projectId,
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
        await onSubmit(value, categoryIds);
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
            <p className="block font-medium text-sm">Image</p>
            <div className="mt-1">
              <ProjectImageUploader
                projectId={projectId}
                currentKey={(field.state.value as string) || null}
                onUploaded={(key) => field.handleChange(key)}
              />
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              Cropped to 16:9 and resized to max 1600x900 before upload.
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
            <label htmlFor="programId" className="block font-medium text-sm">
              Program
            </label>
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
          <p className="block font-medium text-sm">Categories</p>
          <div className="mt-1">
            <CategoryMultiSelect
              value={categoryIds}
              onChange={setCategoryIds}
            />
          </div>
        </div>
      )}

      {formError && (
        <div className="border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {formError}
        </div>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <button
            type="submit"
            disabled={!canSubmit}
            className="bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : submitLabel}
          </button>
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
          <label htmlFor={field.name} className="block font-medium text-sm">
            {label}
          </label>
          {textarea ? (
            <textarea
              id={field.name}
              name={field.name}
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              rows={rows}
              placeholder={placeholder}
              className="mt-1 w-full border p-2"
            />
          ) : (
            <input
              id={field.name}
              name={field.name}
              value={field.state.value as string}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              placeholder={placeholder}
              className="mt-1 w-full border p-2"
            />
          )}
          {field.state.meta.errors.length > 0 && (
            <p className="mt-1 text-red-600 text-sm">
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
