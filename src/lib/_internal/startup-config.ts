/**
 * Which configuration is fatal at boot, and only at boot.
 *
 * Called from `src/nitro/config-check.ts` and nowhere else; the TanStack Start
 * section of docs/QUIRKS.md says why a Nitro plugin is the one home that
 * refuses to boot and why `auth.ts` and the server entry are not. Production
 * only: outside it every variable here fails closed or at first use, as it
 * always has. Names, never values: three of these are secrets, and the message
 * reaches a log group.
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
