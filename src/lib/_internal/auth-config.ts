import { issuerFromDiscoveryUrl } from "./onid-profile";

/**
 * The environment Better Auth is configured from, resolved once and typed.
 *
 * Pure and total on purpose: it never throws and never reads `process.env`
 * except through the argument's default, so `src/lib/auth.ts` stays importable
 * with no environment at all. That matters because `auth.ts` builds its auth
 * object at module scope, so anything that throws in here throws on import, and
 * roughly twenty integration tests import it against a CI `.env.local` that
 * carries no provider credentials. See #137 for the deferred question of which
 * variables should be fatal and where such a check could live.
 *
 * What it buys instead of a throw is `unconfigured`: the names of the variables
 * an operator has to set, reported at boot rather than discovered when a
 * student clicks a sign-in button and gets an error from the provider.
 */
export interface AuthConfig {
  github: { clientId: string; clientSecret: string };
  isProduction: boolean;
  onid: {
    clientId: string;
    clientSecret: string;
    discoveryUrl: string;
    /**
     * Derived rather than configured separately, because the discovery URL
     * already contains the tenant GUID and a second variable is a second thing
     * to get out of step. An empty discovery URL yields an empty issuer, and
     * the mapper refuses every token in that case: ONID sign-in fails closed
     * when it is not configured, rather than accepting tokens from anywhere.
     */
    issuer: string;
  };
  trustHost: boolean;
  /** Names of unset provider credentials, in `.env.example` order. */
  unconfigured: string[];
}

const PROVIDER_VARS = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "ONID_DISCOVERY_URL",
  "ONID_CLIENT_ID",
  "ONID_CLIENT_SECRET",
] as const;

export function buildAuthConfig(
  env: NodeJS.ProcessEnv = process.env
): AuthConfig {
  const discoveryUrl = env.ONID_DISCOVERY_URL ?? "";
  // The credential values below are deliberately not trimmed, while
  // `unconfigured` below them is. That divergence is on purpose and is the
  // pre-existing behaviour: a whitespace-only credential is reported as unset
  // and still handed to the provider verbatim, because trimming it here would
  // be a behaviour change smuggled into a refactor. Whether a blank credential
  // should be rejected outright belongs to #137.
  return {
    github: {
      clientId: env.GITHUB_CLIENT_ID ?? "",
      clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
    },
    isProduction: env.NODE_ENV === "production",
    onid: {
      clientId: env.ONID_CLIENT_ID ?? "",
      clientSecret: env.ONID_CLIENT_SECRET ?? "",
      discoveryUrl,
      issuer: issuerFromDiscoveryUrl(discoveryUrl),
    },
    // Not `=== "production"` like `isProduction` above, and the difference is
    // load-bearing rather than an inconsistency: this is on everywhere except
    // development, because the app sits behind CloudFront and an ALB in
    // production and behind nothing on localhost. See the Better Auth section
    // of docs/QUIRKS.md.
    trustHost: env.NODE_ENV !== "development",
    unconfigured: PROVIDER_VARS.filter((name) => !env[name]?.trim()),
  };
}

/**
 * Names the provider credentials an operator has not set.
 *
 * A warning rather than a throw, because both providers are optional in this
 * deployment: `infra/variables.tf` defaults `github_client_id` to empty, and an
 * unset `ONID_DISCOVERY_URL` is the documented way to turn ONID sign-in off.
 *
 * Takes the names rather than the whole `AuthConfig` so it cannot reach a
 * credential value even by accident. It logs variable names, never values.
 */
export function warnUnconfiguredProviders(
  unconfigured: readonly string[],
  warn: (message: string) => void = console.warn
): void {
  if (unconfigured.length === 0) {
    return;
  }
  warn(
    `Sign-in providers are only partly configured. Unset: ${unconfigured.join(", ")}. Sign-in through the affected provider will fail.`
  );
}
