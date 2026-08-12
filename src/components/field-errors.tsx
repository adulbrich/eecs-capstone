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
export function FieldErrors({ errors }: { errors: readonly unknown[] }) {
  if (errors.length === 0) {
    return null;
  }
  return (
    <p className="mt-1 text-destructive text-sm">
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
