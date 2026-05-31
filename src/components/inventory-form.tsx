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

interface Props {
  initial?: Partial<InventoryFormValues>;
  itemId?: string;
  onSaved?: (itemId: string) => void;
  submitLabel?: string;
}

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
    undefined
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

        if (onSaved) {
          onSaved(savedId);
        }
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

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setFormError(null);
        void form.handleSubmit();
      }}
    >
      <Field form={form} label="Name" name="name" />
      <Field
        form={form}
        label="Description"
        name="description"
        rows={4}
        textarea
      />
      <Field form={form} label="Category" name="category" />
      <Field form={form} label="Serial" name="serial" />
      <Field form={form} label="Location" name="location" />
      <form.Field name="imageUrl">
        {(field: AnyForm) => (
          <div>
            <Label>Image</Label>
            <div className="mt-1">
              <InventoryImageUploader
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
              Cropped to 1:1 and resized to max 1200x1200. Saved when you submit
              the form.
            </p>
          </div>
        )}
      </form.Field>
      <Field
        form={form}
        label="Internal notes (staff only)"
        name="notes"
        rows={3}
        textarea
      />

      {formError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
          {formError}
        </div>
      )}

      <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
        {([canSubmit, isSubmitting]) => (
          <Button disabled={!canSubmit} type="submit">
            {isSubmitting ? "Saving..." : (submitLabel ?? "Save")}
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
  name: keyof InventoryFormValues;
  placeholder?: string;
  rows?: number;
  textarea?: boolean;
}

function Field({ form, name, label, placeholder, textarea, rows }: FieldProps) {
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
        </div>
      )}
    </form.Field>
  );
}
