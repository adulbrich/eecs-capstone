import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { z } from "zod";
import { FieldError } from "#/components/ui/field";
import { submitCustomRequest } from "#/server/inventory-custom";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// No `.default()` anywhere, for the reason `inventory-form.tsx` gives: a
// default makes the field optional on the schema's input type, and
// `validators.onSubmit` wants a schema whose input equals the form's data.
// `quantity` is a number in form state; the input converts on change.
export const customRequestFormSchema = z.object({
  lines: z
    .array(
      z.object({
        name: z.string().min(1, "Name is required").max(200),
        reason: z.string().min(1, "Reason is required").max(2000),
        quantity: z
          .number({ message: "Quantity must be a whole number" })
          .int("Quantity must be a whole number")
          .positive("Quantity must be at least 1")
          .max(100),
        link: z.string().max(500),
      })
    )
    .min(1, "Ask for at least one thing")
    .max(20),
  note: z.string().max(2000),
});

export type CustomRequestFormValues = z.infer<typeof customRequestFormSchema>;

const emptyLine = (name = ""): CustomRequestFormValues["lines"][number] => ({
  name,
  reason: "",
  quantity: 1,
  link: "",
});

// Same localized `any` as `inventory-form.tsx`, for the same reason: the
// `useForm` generics are unstable across releases (see docs/QUIRKS.md).
// biome-ignore lint/suspicious/noExplicitAny: see above
type AnyForm = any;

/**
 * One card per thing asked for, add and remove cards, one optional note for
 * the whole request. The server call stays here, as `InventoryForm` keeps
 * its own; the route only navigates afterwards.
 */
export function CustomRequestForm({
  initialName,
  onSubmitted,
}: {
  /** Seeds the first card's name, from the search that found nothing. */
  initialName?: string;
  onSubmitted: (requestId: string) => void;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm({
    defaultValues: {
      lines: [emptyLine(initialName ?? "")],
      note: "",
    } satisfies CustomRequestFormValues,
    validators: { onSubmit: customRequestFormSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      try {
        const result = await submitCustomRequest({
          data: {
            lines: value.lines.map((line) => ({
              name: line.name,
              reason: line.reason,
              quantity: line.quantity,
              link: line.link || null,
            })),
            note: value.note || null,
          },
        });
        onSubmitted(result.requestId);
      } catch (err) {
        setFormError((err as Error)?.message || "Submit failed");
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
      <form.Field mode="array" name="lines">
        {(lines: AnyForm) => (
          <div className="space-y-4">
            {(lines.state.value as CustomRequestFormValues["lines"]).map(
              (_, i) => (
                // TanStack Form addresses array items by index, and
                // removeValue renumbers the rest, so the index is the item's
                // identity here; a card holds no state of its own beyond
                // what the form holds for it.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                <Card asChild key={i}>
                  <section aria-labelledby={`line-${i}-heading`}>
                    <CardHeader className="flex flex-row items-center justify-between">
                      <CardTitle id={`line-${i}-heading`}>
                        Thing {i + 1}
                      </CardTitle>
                      {lines.state.value.length > 1 && (
                        <Button
                          onClick={() => lines.removeValue(i)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Remove
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <form.Field name={`lines[${i}].name`}>
                        {(field: AnyForm) => (
                          <div>
                            <Label htmlFor={field.name}>Name</Label>
                            <Input
                              className="mt-1"
                              id={field.name}
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                              value={field.state.value}
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </div>
                        )}
                      </form.Field>
                      <form.Field name={`lines[${i}].reason`}>
                        {(field: AnyForm) => (
                          <div>
                            <Label htmlFor={field.name}>Why you need it</Label>
                            <Textarea
                              className="mt-1"
                              id={field.name}
                              name={field.name}
                              onBlur={field.handleBlur}
                              onChange={(e) =>
                                field.handleChange(e.target.value)
                              }
                              rows={2}
                              value={field.state.value}
                            />
                            <FieldError errors={field.state.meta.errors} />
                          </div>
                        )}
                      </form.Field>
                      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                        <form.Field name={`lines[${i}].quantity`}>
                          {(field: AnyForm) => (
                            <div>
                              <Label htmlFor={field.name}>Quantity</Label>
                              <Input
                                className="mt-1"
                                id={field.name}
                                min={1}
                                name={field.name}
                                onBlur={field.handleBlur}
                                onChange={(e) =>
                                  field.handleChange(
                                    e.target.value === ""
                                      ? Number.NaN
                                      : Number(e.target.value)
                                  )
                                }
                                type="number"
                                value={
                                  Number.isNaN(field.state.value)
                                    ? ""
                                    : field.state.value
                                }
                              />
                              <FieldError errors={field.state.meta.errors} />
                            </div>
                          )}
                        </form.Field>
                        <form.Field name={`lines[${i}].link`}>
                          {(field: AnyForm) => (
                            <div>
                              <Label htmlFor={field.name}>
                                Link or part number (optional)
                              </Label>
                              <Input
                                className="mt-1"
                                id={field.name}
                                name={field.name}
                                onBlur={field.handleBlur}
                                onChange={(e) =>
                                  field.handleChange(e.target.value)
                                }
                                value={field.state.value}
                              />
                              <FieldError errors={field.state.meta.errors} />
                            </div>
                          )}
                        </form.Field>
                      </div>
                    </CardContent>
                  </section>
                </Card>
              )
            )}
            <Button
              onClick={() => lines.pushValue(emptyLine())}
              size="sm"
              type="button"
              variant="outline"
            >
              Add another thing
            </Button>
            <FieldError errors={lines.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field name="note">
        {(field: AnyForm) => (
          <div>
            <Label htmlFor={field.name}>Note for staff (optional)</Label>
            <Textarea
              className="mt-1"
              id={field.name}
              name={field.name}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="When you need it, or which project it is for"
              rows={2}
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      {formError && <p className="text-destructive text-sm">{formError}</p>}
      <form.Subscribe selector={(state: AnyForm) => state.isSubmitting}>
        {(isSubmitting: boolean) => (
          <Button disabled={isSubmitting} type="submit">
            {isSubmitting ? "Submitting..." : "Submit request"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
