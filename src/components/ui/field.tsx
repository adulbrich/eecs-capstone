import type * as React from "react";
import { Label } from "#/components/ui/label.tsx";
import { cn } from "#/lib/utils.ts";

/**
 * The label/control/error triple, as one shape.
 *
 * Replaces the `space-y-1.5` div the design doc described, which every form
 * wrote by hand and six controls forgot: they shipped with a placeholder and no
 * label at all. A placeholder is not a label. It disappears the moment the user
 * types, and axe does not report it, because `placeholder` is a fallback in the
 * accessible-name computation, so the name is technically non-empty.
 *
 * This is `field`, not `form`. Upstream `form` hard-depends on react-hook-form
 * and this project uses TanStack Form; `field` has no npm dependencies at all.
 */
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("space-y-1.5", className)}
      data-slot="field"
      {...props}
    />
  );
}

function FieldLabel({ ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" {...props} />;
}

/**
 * The one place that knows a form error can be a string or an object.
 *
 * Which one arrives depends on the validator. A Standard Schema, which is what
 * both forms now pass, produces `{ message }` issues; a hand-written validator
 * or a server error can produce a bare string. Rendering both is cheaper than
 * making every call site know which it has.
 *
 * Six `form.Field` render props displayed no errors at all before this existed,
 * so a failed validation greyed out the Save button and said nothing.
 */
function FieldError({ errors }: { errors: readonly unknown[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <p className="mt-1 text-destructive text-sm" data-slot="field-error">
      {errors
        .map((e: unknown) =>
          typeof e === "string"
            ? e
            : ((e as { message?: string })?.message ?? String(e))
        )
        .join(", ")}
    </p>
  );
}

export { Field, FieldError, FieldLabel };
