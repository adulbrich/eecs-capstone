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
 * Refusing rather than substituting something, because every way in that this
 * repo actually drives already carries a name: the profile form and the
 * sign-up form both mark the field required, `onid-profile.ts` falls back to
 * the address local part before Better Auth ever sees the profile, and the
 * GitHub provider falls back to the login. What is left is a direct call to
 * the sign-up endpoint, where a blank name is a caller's mistake worth
 * reporting rather than a name worth inventing.
 */
export function requireUserName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) {
    throw new APIError("BAD_REQUEST", { message: "Name is required" });
  }
  return name;
}
