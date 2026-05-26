import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { applyServerErrors } from "#/lib/apply-server-errors";
import {
  createInventoryItem,
  updateInventoryItem,
  uploadInventoryImage,
} from "#/server/inventory";
import { InventoryImageUploader } from "./inventory-image-uploader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

export const inventoryFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(5000).default(""),
  category: z.string().max(120).default(""),
  serial: z.string().max(120).default(""),
  location: z.string().max(200).default(""),
  notes: z.string().max(5000).default(""),
  imageUrl: z.union([z.literal(""), z.string().max(500)]).default(""),
});

export type InventoryFormValues = z.infer<typeof inventoryFormSchema>;

type Props = {
  itemId?: string;
  initial?: Partial<InventoryFormValues>;
  submitLabel?: string;
  onSaved?: (itemId: string) => void;
};

export function InventoryForm({
  itemId,
  initial,
  submitLabel,
  onSaved,
}: Props) {
  const [formError, setFormError] = useState<string | null>(null);
  // `undefined`: user did not touch the image. `File`: new file to upload on
  // submit. `null`: user clicked Remove, server should clear the image.
  const [pendingImage, setPendingImage] = useState<File | null | undefined>(
    undefined,
  );

  const form = useForm({
    defaultValues: {
      name: initial?.name ?? "",
      description: initial?.description ?? "",
      category: initial?.category ?? "",
      serial: initial?.serial ?? "",
      location: initial?.location ?? "",
      notes: initial?.notes ?? "",
      imageUrl: initial?.imageUrl ?? "",
    } satisfies InventoryFormValues,
    validators: {
      onSubmit: ({ value }) => {
        const result = inventoryFormSchema.safeParse(value);
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
        const payload = {
          name: value.name,
          description: value.description || null,
          category: value.category || null,
          serial: value.serial || null,
          location: value.location || null,
          notes: value.notes || null,
          imageUrl: pendingImage === null ? null : value.imageUrl || null,
        };

        let savedId: string;
        if (itemId) {
          const result = await updateInventoryItem({
            data: { id: itemId, ...payload },
          });
          savedId = result.id;
        } else {
          const result = await createInventoryItem({ data: payload });
          savedId = result.id;
        }

        if (pendingImage instanceof File) {
          const fd = new FormData();
          fd.append("itemId", savedId);
          fd.append("file", pendingImage);
          await uploadInventoryImage({ data: fd });
        }

        if (onSaved) onSaved(savedId);
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
      <Field form={form} name="name" label="Name" />
      <Field
        form={form}
        name="description"
        label="Description"
        textarea
        rows={4}
      />
      <Field form={form} name="category" label="Category" />
      <Field form={form} name="serial" label="Serial" />
      <Field form={form} name="location" label="Location" />
      <form.Field name="imageUrl">
        {(field: AnyForm) => (
          <div>
            <Label>Image</Label>
            <div className="mt-1">
              <InventoryImageUploader
                currentKey={(field.state.value as string) || null}
                onChange={(file) => {
                  setPendingImage(file);
                  if (file === null) field.handleChange("");
                }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Cropped to 1:1 and resized to max 1200x1200. Saved when you submit
              the form.
            </p>
          </div>
        )}
      </form.Field>
      <Field
        form={form}
        name="notes"
        label="Internal notes (staff only)"
        textarea
        rows={3}
      />

      {formError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {formError}
        </div>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <Button type="submit" disabled={!canSubmit}>
            {isSubmitting ? "Saving..." : (submitLabel ?? "Save")}
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
  name: keyof InventoryFormValues;
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
