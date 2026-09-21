/**
 * The social summary kill switch, alone in its own module for the same reason
 * `embeddings-flag.ts` is: reading a flag should not cost an SDK import.
 * `social-summary-core.ts` pulls in the Mantle signer at its top level, and
 * `refreshSocialSummary` wants to know whether to bother before paying for
 * that.
 *
 * Set `BEDROCK_SOCIAL_SUMMARY_ENABLED=false` to make every generation skip
 * without touching AWS. It matters more here than for the AI review and the
 * scope assessment, which only run when someone presses a button: this one
 * runs on every publish, archive and edit of a live project, so a developer
 * working offline would otherwise pay a credential-chain probe per save.
 *
 * Read on every call, not captured at import. As a module-level `const` this
 * would depend on import order and on nothing replacing `process.env`, and a
 * kill switch that can fail open by accident is not a kill switch (see #22,
 * which is the same bug in the embeddings flag).
 *
 * Anything but the exact string "false" is on, so unset is on.
 */
export function socialSummariesEnabled(): boolean {
  return process.env.BEDROCK_SOCIAL_SUMMARY_ENABLED !== "false";
}
