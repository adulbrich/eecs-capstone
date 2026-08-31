import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { FieldError } from "#/components/ui/field";
import { applyServerErrors } from "#/lib/apply-server-errors";
import { imageUrlToSave } from "#/lib/image-save";
import {
  PRIVATE_NOTES_INVENTORY_HINT,
  PRIVATE_NOTES_LABEL,
  STAFF_ONLY_FIELD_HINT,
} from "#/lib/private-notes";
import {
  createInventoryItem,
  type itemPayloadSchema,
  updateInventoryItem,
  uploadInventoryImage,
} from "#/server/inventory";
import { CategoryMultiSelect } from "./category-multi-select";
import { InventoryImageUploader } from "./inventory-image-uploader";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// No `.default()` anywhere on purpose. A default makes that field optional on
// the schema's INPUT type, and `validators.onSubmit` requires a Standard Schema
// whose input equals the form's data type, so one default blocks passing the
// schema directly. `defaultValues` below supplies every field regardless.
export const inventoryFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(5000),
  categoryIds: z.array(z.string().uuid()).max(20),
  serial: z.string().max(120),
  label: z.string().max(120),
  location: z.string().max(200),
  notes: z.string().max(5000),
  imageUrl: z.union([z.literal(""), z.string().max(500)]),
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
      categoryIds: initial?.categoryIds ?? [],
      serial: initial?.serial ?? "",
      label: initial?.label ?? "",
      location: initial?.location ?? "",
      notes: initial?.notes ?? "",
      imageUrl: initial?.imageUrl ?? "",
    } satisfies InventoryFormValues,
    validators: {
      // The schema itself. react-form takes a Standard Schema and Zod 4
      // schemas are ones; this was a hand-rolled safeParse loop for a typing
      // limitation that no longer exists. See QUIRKS.
      onSubmit: inventoryFormSchema,
    },
    onSubmit: async ({ value }) => {
      setFormError(null);
      try {
        // `satisfies` makes a missing or misspelled key a compile error right
        // here, at the point the payload is built, instead of one that
        // typechecks and then writes `null` (via itemPayloadSchema's
        // `.nullable().default(null)`) for a field nobody set.
        const payload = {
          name: value.name,
          description: value.description || null,
          categoryIds: value.categoryIds,
          serial: value.serial || null,
          label: value.label || null,
          location: value.location || null,
          notes: value.notes || null,
          imageUrl: pendingImage === null ? null : value.imageUrl || null,
        } satisfies Required<z.input<typeof itemPayloadSchema>>;

        let savedId: string;
        if (itemId) {
          // Upload before the row write, so the key is an ordinary field on the
          // save. The old order wrote the row and then uploaded, which kept the
          // image change out of the item's edit log and left a failed upload
          // half applied. Same fix as #88 on the project side.
          const imageUrl = await imageUrlToSave({
            currentImageUrl: payload.imageUrl,
            owner: { itemId },
            pendingImage,
            upload: uploadInventoryImage,
          });
          const result = await updateInventoryItem({
            data: { id: itemId, ...payload, imageUrl },
          });
          savedId = result.id;
        } else {
          // Create cannot upload first: the key is `inventory/<id>/...` and the
          // upload loads the item to check it exists, so there is nothing to
          // upload into until the row does. Hence a second write here.
          const result = await createInventoryItem({ data: payload });
          savedId = result.id;
          if (pendingImage instanceof File) {
            const imageUrl = await imageUrlToSave({
              currentImageUrl: payload.imageUrl,
              owner: { itemId: savedId },
              pendingImage,
              upload: uploadInventoryImage,
            });
            await updateInventoryItem({
              data: { id: savedId, ...payload, imageUrl },
            });
          }
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
      <form.Field name="categoryIds">
        {(field: AnyForm) => (
          <div className="flex flex-col gap-2">
            <Label>Categories</Label>
            <CategoryMultiSelect
              domain="inventory"
              onChange={(ids) => field.handleChange(ids)}
              value={field.state.value as string[]}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
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
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      {/* These four never reach the public item page, and the split matches
          `stripForPublic` on the server exactly: name, description, category
          and image are public; serial, label, location and notes are not.
          That used to be said once, by a panel drawn around them. Saying it
          per field instead keeps the form a single column of inputs, and a
          reader scanning one field no longer has to look upward to find out
          whether what they type will be public. Notes carries its own,
          longer line, which already says the same thing with examples. */}
      <Field
        description={STAFF_ONLY_FIELD_HINT}
        form={form}
        label="Serial"
        name="serial"
      />
      <Field
        description={STAFF_ONLY_FIELD_HINT}
        form={form}
        label="Label"
        name="label"
      />
      <Field
        description={STAFF_ONLY_FIELD_HINT}
        form={form}
        label="Location"
        name="location"
      />
      <Field
        description={PRIVATE_NOTES_INVENTORY_HINT}
        form={form}
        label={PRIVATE_NOTES_LABEL}
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
  /** Helper text rendered under the label and wired up via aria-describedby. */
  description?: string;
  form: AnyForm;
  label: string;
  name: keyof InventoryFormValues;
  placeholder?: string;
  rows?: number;
  textarea?: boolean;
}

function Field({
  description,
  form,
  name,
  label,
  placeholder,
  textarea,
  rows,
}: FieldProps) {
  const descriptionId = description ? `${name}-description` : undefined;
  return (
    <form.Field name={name as never}>
      {(field: AnyForm) => (
        <div>
          <Label htmlFor={field.name}>{label}</Label>
          {description && (
            <p
              className="mt-0.5 text-muted-foreground text-xs"
              id={descriptionId}
            >
              {description}
            </p>
          )}
          {textarea ? (
            <Textarea
              aria-describedby={descriptionId}
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
              aria-describedby={descriptionId}
              className="mt-1"
              id={field.name}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={placeholder}
              value={field.state.value as string}
            />
          )}
          <FieldError errors={field.state.meta.errors} />
        </div>
      )}
    </form.Field>
  );
}
