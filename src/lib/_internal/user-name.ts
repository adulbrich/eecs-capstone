import { APIError } from "better-auth/api";

/**
 * The one rule for `user.name` on the way in: trimmed, and not blank.
 *
 * `notNull` on the column reads as a guarantee that a name is something, and
 * it is not: Better Auth validates the sign-up body's `name` with a bare
 * `z.string()`, which accepts `""`, and nothing in this repo narrowed it. An
 * account created that way renders as nothing at all, and the surfaces around
 * it render a label with no value: "by " on the status timeline, an empty
 * author line on a comment, a blank cell in the admin users table.
 *
 * Normalizing here rather than defending at each render site is the argument
 * ADR 0015 already made for addresses, and it is the same argument.
 *
 * Blankness only. `profileSchema` also caps a name at 120 characters and this
 * does not, because the two refusals land differently: a refused profile save
 * puts a message under the field the person is typing in, while a refused
 * OAuth creation becomes a redirect carrying an error, which is no place to
 * tell somebody their name is too long. Length is the form's rule, and #433
 * put a shape rule out of scope.
 *
 * Refusing rather than substituting something, because every way in that this
 * repo actually drives already carries a name: the profile form and the code
 * form's name step both mark the field required, `onid-profile.ts` falls back to
 * the address local part before Better Auth ever sees the profile, and the
 * GitHub provider falls back to the login. What is left is a direct call to
 * the sign-up endpoint, where a blank name is a caller's mistake worth
 * reporting rather than a name worth inventing.
 *
 * Where the refusal surfaces depends on the caller. Email sign-up rethrows an
 * APIError as a 400, which is what `sign-up.mjs` does with anything
 * `isAPIError`. A first OAuth sign-in does not: `handleOAuthUserInfo` catches
 * it and redirects with the message as an error parameter. Both refuse the
 * account, which is the point; neither reaches a form field.
 */
export function requireUserName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new APIError("BAD_REQUEST", { message: "Name is required" });
  }
  return name;
}
