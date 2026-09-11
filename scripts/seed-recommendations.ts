/**
 * The vectors the dev seed writes so the recommended sort has a known answer.
 *
 * Bedrock never runs in a browser suite: `playwright.e2e.config.ts` sets
 * `BEDROCK_EMBEDDINGS_ENABLED=false`, so a project published there gets no
 * vector and a saved interest statement gets none either. The seed writes
 * these straight into `projects.embedding` and `user_interests.embedding`
 * instead, the shape `recommended-sort.integration.test.ts` already uses, and
 * the end-to-end suite asserts the order they produce (#321).
 *
 * Shared by `seed-dev.ts` and `src/test/e2e/recommendations.e2e.test.ts` so
 * the order the seed encodes and the order the test expects are one list.
 * `seed-dev.ts` cannot export it itself: importing that module runs the seed.
 */

/** Titan's output width, which the two `vector` columns are declared at. */
export const EMBEDDING_DIMENSIONS = 1024;

/** What `user@example.com` says they are interested in. */
export const SEED_INTERESTS_TEXT =
  "Machine learning on embedded hardware, computer vision, and robotics.";

/**
 * Every published seed project, in the order the recommended sort returns
 * them for `user@example.com`: nearest to the interest vector first. The
 * order is chosen to read as plausible for the interests above; the vectors
 * below are what make it true.
 */
export const SEED_RECOMMENDED_TITLES = [
  "ML-Powered Wildlife Camera-Trap Classifier",
  "Edge AI Inference on Single-Board Computers",
  "Autonomous Warehouse Robot Fleet Coordinator",
  "Real-Time Analytics Dashboard for IoT Sensor Networks",
  "Accessible Course Scheduling Assistant",
] as const;

function zeros(): number[] {
  return new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
}

/** The interest vector: the first axis. */
export function seedInterestsVector(): number[] {
  const v = zeros();
  v[0] = 1;
  return v;
}

/**
 * The vector for the project at `rank` in `SEED_RECOMMENDED_TITLES`: a unit
 * vector in the plane of the first two axes, rotated a little further from
 * the interest vector for each rank, so cosine distance grows with rank and
 * nothing depends on floating-point ties.
 */
export function seedProjectVector(rank: number): number[] {
  const angle = (rank + 1) * 0.25;
  const v = zeros();
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
}
