/**
 * Which configuration is fatal at boot, and only at boot.
 *
 * The check runs from `src/nitro/config-check.ts`, a Nitro plugin, and from
 * nowhere else. Module-level code in `src/lib/auth.ts` or `src/db/index.ts`
 * would run on import, and roughly twenty integration tests import those
 * against a CI `.env.local` that carries no provider credentials; a throw
 * there reds the whole suite, and the tempting fix, faking the credentials in
 * the heredoc, makes the check assert nothing. A TanStack Start server entry
 * (`src/server.ts`) is no better a home: Nitro loads it on the first request,
 * not at boot, so a throw there keeps the port bound and answers 500. A Nitro
 * plugin runs before the listener binds, so a throw there is exit code 1 and
 * no port. Both were measured on the built output; see the TanStack Start
 * section of docs/QUIRKS.md.
 *
 * Production only. A dev machine with no ONID registration is a normal state,
 * and every variable here fails closed or at first use outside production, as
 * it always has.
 *
 * Names, never values: three of these are secrets, and the message reaches a
 * log group.
 */

/**
 * The variables the app cannot serve a single request without, in
 * `.env.example` order. `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are not
 * here on purpose: `infra/variables.tf` defaults the id to empty, so GitHub
 * sign-in is optional and `warnUnconfiguredProviders` names it instead.
 */
export function missingProductionConfig(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  if (env.NODE_ENV !== "production") {
    return [];
  }
  // Read one by one rather than looked up by name from a list, so the
  // env-contract test, which finds reads by scanning the source for the
  // variable names, counts each of these as a read and holds `.env.example`
  // and `infra/ecs.tf` to it.
  const values = {
    DATABASE_URL: env.DATABASE_URL,
    BETTER_AUTH_URL: env.BETTER_AUTH_URL,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
    ONID_DISCOVERY_URL: env.ONID_DISCOVERY_URL,
    ONID_CLIENT_ID: env.ONID_CLIENT_ID,
    ONID_CLIENT_SECRET: env.ONID_CLIENT_SECRET,
    S3_BUCKET: env.S3_BUCKET,
  };
  return Object.entries(values)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
}

/**
 * Throws one error naming every missing variable, so an operator fixes the
 * task definition once rather than once per restart.
 */
export function assertProductionConfig(
  env: NodeJS.ProcessEnv = process.env
): void {
  const missing = missingProductionConfig(env);
  if (missing.length === 0) {
    return;
  }
  throw new Error(
    `Refusing to start: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. Every one of these is required when NODE_ENV is production; see the runtime environment list in DEPLOYMENT.md.`
  );
}
