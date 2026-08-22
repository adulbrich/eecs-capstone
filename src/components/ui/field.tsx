/**
 * The shared form-error renderer.
 *
 * `inventory-form.tsx` and `project-form.tsx` each write their own local
 * label/input/error wrapper by hand, because each is a TanStack Form binding
 * (it renders `<form.Field>` and wires `handleChange`/`handleBlur`), not a
 * layout primitive.
 *
 * This is `field`, not `form`. Upstream `form` hard-depends on react-hook-form
 * and this project uses TanStack Form; `field` has no npm dependencies at all.
 */

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

export { FieldError };
