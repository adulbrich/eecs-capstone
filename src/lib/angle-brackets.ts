/**
 * Proposer text goes into a Bedrock prompt wrapped in tags the builder writes
 * (`<Description>`, `<field name="...">`), and each system prompt says what is
 * inside them is data. A value holding `</Description>` closed its own tag,
 * and whatever followed read as outside it (#841). With every `<` and `>` in a
 * value written as an entity, the only tags in the prompt are the builder's.
 *
 * Not `&`. A tag needs `<` and `>`, so escaping `&` blocks nothing, and every
 * project with an ampersand in its text would hash stale and pay a model call
 * to regenerate. The cost is that an author's literal `&lt;` reads to the
 * model as `<`, which changes no tag.
 *
 * Dependency-free, and copied into `scripts/backfill-social-summaries.mjs`,
 * whose parity test pins the body: change both or neither.
 */
export function escapeAngleBrackets(text: string): string {
  return text.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
