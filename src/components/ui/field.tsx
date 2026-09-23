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
 */
function errorText(e: unknown): string {
  if (typeof e === "string") {
    return e;
  }
  if (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof e.message === "string"
  ) {
    return e.message;
  }
  return String(e);
}

/**
 * Either shape, never both, the way `Button` types `asChild` against `type`.
 *
 * A TanStack Form field hands over `field.state.meta.errors`, an array. Every
 * other caller holds one `string | null` from a `catch`, and asking those forty
 * sites to write `errors={error ? [error] : []}` would be a worse component
 * than one that takes the string.
 *
 * `?: never` stops a caller passing both, though an explicit
 * `message={undefined}` beside `errors` still typechecks, since an optional
 * `never` admits `undefined`. That costs nothing at runtime: `??` reads it as
 * absent and `errors` wins, which is the branch such a caller meant.
 */
type FieldErrorProps = (
  | { errors: readonly unknown[]; message?: never }
  | { message: unknown; errors?: never }
) & {
  /** For a field that points `aria-describedby` at its error. */
  id?: string;
};

/**
 * What a form says when it worked, under that form's own submit button.
 *
 * A save that stays on the page confirms in place rather than by toast
 * (UI-CONVENTIONS, "Mutations and feedback"). `output` rather than the
 * `role="alert"` paragraph `FieldError` is: a result the reader asked for is
 * announced politely, an error interrupts. The two used to be one component
 * on `profile.tsx` switching on a `kind`, which put a failure in the polite
 * element and gave that page the only error text in the app not shaped like
 * the rest (#410).
 */
function SavedNote({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <output className="mt-2 block text-sm" style={SAVED_COLOR}>
      {message}
    </output>
  );
}

// The token the status badges use, for the reason UI-CONVENTIONS gives: a
// hex code never goes in a component.
const SAVED_COLOR = { color: "var(--status-success)" };

/**
 * The one error paragraph.
 *
 * Six `form.Field` render props displayed no errors at all before this existed,
 * so a failed validation greyed out the Save button and said nothing. About
 * forty other sites then wrote the same paragraph by hand and drifted apart on
 * margin and text size, and all but two of them said nothing to a screen reader
 * either (#411).
 *
 * `role="alert"` rather than `aria-live="polite"`: this text appears because
 * the reader just pressed something and it failed, which is the case the
 * assertive role exists for. It also means an empty paragraph left in the DOM
 * would announce on every change, so nothing renders when there is nothing to
 * say, and a caller needs no `{error && ...}` guard of its own.
 *
 * No `className`: the point of the component is one margin, and none of the
 * fifty-nine call sites that replaced a hand-written paragraph turned out to
 * need a different one.
 */
function FieldError({ errors, id, message }: FieldErrorProps) {
  const blank = message === null || message === undefined || message === "";
  const items = errors ?? (blank ? [] : [message]);
  if (items.length === 0) {
    return null;
  }
  return (
    <p
      className="mt-1 text-destructive text-sm"
      data-slot="field-error"
      id={id}
      role="alert"
    >
      {items.map(errorText).join(", ")}
    </p>
  );
}

export { FieldError, SavedNote };
