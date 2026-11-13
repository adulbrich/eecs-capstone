/**
 * The categorizer's kill switch, alone in its own module for the reason
 * `social-summary-flag.ts` is: reading a flag should not cost the Mantle
 * signer's import.
 *
 * Set `BEDROCK_CATEGORIES_ENABLED=false` to make the automatic run on submit
 * and the backfill skip without touching AWS (#31). Both run with no one
 * pressing a button for that project, so a developer offline would otherwise
 * pay a credential-chain probe per submission, and the integration suite would
 * reach AWS from every test that submits. Regenerate is a button and ignores
 * it, as the social summary's Regenerate does.
 *
 * Read on every call, not captured at import (#22). Anything but the exact
 * string "false" is on, so unset is on.
 */
export function categoriesEnabled(): boolean {
  return process.env.BEDROCK_CATEGORIES_ENABLED !== "false";
}
