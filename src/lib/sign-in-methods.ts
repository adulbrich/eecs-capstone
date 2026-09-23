import { type AddressHolder, addressProofRefused } from "./address-proof";

const PROVIDER_LABELS: Record<string, string> = {
  github: "GitHub",
  onid: "ONID",
  google: "Google",
  linkedin: "LinkedIn",
  discord: "Discord",
};

const providerLabel = (id: string) => PROVIDER_LABELS[id] ?? id;

/**
 * How this person can sign in, for the admin user page.
 *
 * An emailed code needs no `account` row, so it is not read from one: it is
 * listed unless `addressProofRefused` says the code guard turns it away, the
 * same rule the guard reads (#605). A `credential` row is left out: production
 * still holds the ones written before #576, and none of them signs anybody in.
 *
 * An empty list is possible, an unverified and banned row with nothing but a
 * `credential` on it, and the page shows "none" for it. The ban itself is
 * shown elsewhere on the page, so this does not repeat why.
 */
export function signInMethods(
  row: AddressHolder,
  providers: readonly string[],
  now: Date = new Date()
): string[] {
  const linked = providers
    .filter((id) => id !== "credential")
    .map(providerLabel);
  return addressProofRefused(row, providers, now)
    ? linked
    : ["Emailed code", ...linked];
}
