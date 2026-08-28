/**
 * The embeddings kill switch, alone in its own module.
 *
 * Set `BEDROCK_EMBEDDINGS_ENABLED=false` to make every embedding attempt fail
 * instantly without touching AWS. It is a test and local-development switch:
 * `infra/ecs.tf` plumbs the model id and dimensions into the task definition
 * but not this, so turning embeddings off in production is a terraform change
 * and a new revision, not a variable flip.
 *
 * It lives here rather than beside the adapter because reading a flag should
 * not cost an SDK. `bedrock-embed.ts` imports `@aws-sdk/client-bedrock-runtime`
 * at its top level, so anything that only wants to know whether embeddings are
 * on, such as the integration-suite guard in `src/test/setup.integration.ts`,
 * would otherwise load the whole client to read one string.
 *
 * Read on every call, not captured once at import. As a module-level `const`
 * this depended on import order and on nothing replacing `process.env`, and a
 * kill switch that can fail open by accident is not a kill switch. When it does
 * fail open under test there is no fast error: the call reaches the AWS SDK,
 * which walks the credential chain and pays an IMDS probe with retries, which
 * is seconds per call rather than a clean failure. See #22.
 *
 * Anything but the exact string "false" is on, so unset is on.
 */
export function embeddingsEnabled(): boolean {
  return process.env.BEDROCK_EMBEDDINGS_ENABLED !== "false";
}
