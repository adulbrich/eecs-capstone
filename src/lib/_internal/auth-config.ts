import { issuerFromDiscoveryUrl } from "./onid-profile";

/**
 * The environment Better Auth is configured from, resolved once and typed.
 *
 * Pure and total on purpose: it never throws and never reads `process.env`
 * except through the argument's default, so `src/lib/auth.ts` stays importable
 * with no environment at all. That matters because `auth.ts` builds its auth
 * object at module scope, so anything that throws in here throws on import, and
 * roughly twenty integration tests import it against a CI `.env.local` that
 * carries no provider credentials. The variables that are fatal in production
 * are checked from a Nitro plugin instead, which no test imports; see
 * `startup-config.ts`.
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
     * the mapper refuses every token in that case: in development and test,
     * ONID sign-in fails closed when it is not configured, rather than
     * accepting tokens from anywhere. Production refuses to boot without it
     * (`src/nitro/config-check.ts`), so the fail-closed path is never what a
     * deployed task is relying on.
     */
    issuer: string;
  };
  trustHost: boolean;
  /** Names of unset provider credentials, in `.env.example` order. */
  unconfigured: readonly string[];
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
  // The credential values below are not trimmed; `unconfigured` is. Only the
  // untrimmed pass-through is pre-existing, so the divergence itself is new
  // here: a whitespace-only credential is now reported as unset while still
  // reaching the provider verbatim. Trimming the value would be a behaviour
  // change smuggled into a refactor, so it is left alone. Whether a blank
  // credential should be rejected outright belongs to #137.
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
    // Not `=== "production"` like `isProduction` above. The two agree under
    // `development` and `production` and disagree under every other value,
    // unset included. Nothing rides on that, because both the Dockerfile and
    // the ECS task definition set `production` explicitly, so deployed code
    // only ever sees a value they agree on. It is residue from the two lines
    // arriving in separate commits, not a decision. See the Better Auth
    // section of docs/QUIRKS.md.
    trustHost: env.NODE_ENV !== "development",
    unconfigured: PROVIDER_VARS.filter((name) => !env[name]?.trim()),
  };
}

/**
 * Names the provider credentials an operator has not set.
 *
 * A warning rather than a throw, because this runs on import and the
 * integration suite imports it with nothing set. GitHub is optional everywhere:
 * `infra/variables.tf` defaults `github_client_id` to empty. ONID is optional
 * only outside production, where an unset `ONID_DISCOVERY_URL` turns it off;
 * a production task without it is stopped by `assertProductionConfig` before
 * this warning would print.
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
