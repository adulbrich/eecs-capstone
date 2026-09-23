/**
 * Whether proving an address may take the row that holds it (#605).
 *
 * Two things prove an address here: an emailed code, and an ONID sign-in. Each
 * one, pointed at an unverified row, verifies that row and hands it to whoever
 * proved the address: the code through Better Auth's
 * `revokeUnprovenAccountAccess`, ONID through `releaseUnverifiedAddress`. This
 * is the one rule for when that must not happen, and three places read it: the
 * code guard (`otp-sign-in-guard.ts`), the ONID release
 * (`release-unverified-address.ts`), and the sign-in list on the admin user
 * page. They were three copies of the rule and the admin page had none, so the
 * page listed a code that the guard refused.
 *
 * A verified row is never taken: proving the address signs its owner in.
 * An unverified row is refused in two cases, ADR-0045 and ADR-0047 say why:
 *
 * - **An active ban.** Taking the row would rewrite a decision an admin made.
 * - **Another provider linked.** Proving the address says nothing about the
 *   identity already on the row, and taking it would leave one row answering
 *   to two people. A `credential` account is not a provider: it is the
 *   unproven password this exists to take away.
 *
 * Pure and import free, because the admin page renders it in the browser and
 * the other two call it from the server.
 */
export interface AddressHolder {
  banExpires: Date | null;
  banned: boolean | null;
  emailVerified: boolean;
}

/**
 * Whether a ban still holds, by the same test the admin plugin applies when a
 * session is created (`better-auth/dist/plugins/admin/admin.mjs`): a ban whose
 * `banExpires` has passed is cleared there and the session goes through, so
 * refusing on it here would be stricter than the ban itself.
 */
export function banIsActive(
  row: Pick<AddressHolder, "banExpires" | "banned">,
  now: Date = new Date()
): boolean {
  if (!row.banned) {
    return false;
  }
  return row.banExpires === null || row.banExpires.getTime() >= now.getTime();
}

export function addressProofRefused(
  row: AddressHolder,
  providers: readonly string[],
  now: Date = new Date()
): boolean {
  if (row.emailVerified) {
    return false;
  }
  return (
    banIsActive(row, now) ||
    providers.some((providerId) => providerId !== "credential")
  );
}
