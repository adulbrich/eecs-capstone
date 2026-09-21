import { describe, expect, it } from "vitest";
import { EMBEDDING_MODEL_ID } from "#/lib/_internal/bedrock-embed";
import {
  buildInterestsEmbeddingSource,
  buildProjectEmbeddingSource,
  EMBEDDING_SOURCE_LIMIT,
  type EmbeddableProject,
  embeddingHash,
} from "#/lib/embedding-source";

const project: EmbeddableProject = {
  title: "Autonomous Rover Telemetry",
  description: "A rover that streams sensor data.",
  problemStatement: "Field data is collected by hand.",
  objectives: "Build an ingest pipeline.",
  minQualifications: "C and Python.",
  prefQualifications: "Prior robotics work.",
  licenseRestrictions: "MIT.",
};

describe("buildProjectEmbeddingSource", () => {
  it("includes every text field", () => {
    const source = buildProjectEmbeddingSource(project);
    expect(source).toContain("Autonomous Rover Telemetry");
    expect(source).toContain("streams sensor data");
    expect(source).toContain("collected by hand");
    expect(source).toContain("ingest pipeline");
    expect(source).toContain("C and Python");
    expect(source).toContain("Prior robotics work");
    expect(source).toContain("MIT");
  });

  /**
   * The negative is the point, and it is asserted on the labels rather than on
   * the values: a project whose description happens to say "Robotics" is still
   * correct, and an assertion on the word would fail for the wrong reason.
   * ADR-0025 is why they are out, and this is what would notice them coming
   * back by accident: every stored hash would stop matching at once, at one
   * paid Bedrock call per project, with nothing else to say so.
   */
  it("carries no Categories or Program section", () => {
    const source = buildProjectEmbeddingSource(project);
    expect(source).not.toContain("Categories:");
    expect(source).not.toContain("Program:");
  });

  it("omits empty fields rather than emitting bare labels", () => {
    const source = buildProjectEmbeddingSource({
      ...project,
      objectives: null,
      licenseRestrictions: null,
    });
    expect(source).not.toContain("Objectives:");
    expect(source).not.toContain("License:");
  });

  it("truncates at the source limit", () => {
    const source = buildProjectEmbeddingSource({
      ...project,
      description: "x".repeat(60_000),
    });
    expect(source.length).toBe(EMBEDDING_SOURCE_LIMIT);
  });
});

describe("buildInterestsEmbeddingSource", () => {
  it("passes the text through and truncates at the limit", () => {
    expect(buildInterestsEmbeddingSource("  robotics  ")).toBe("robotics");
    expect(buildInterestsEmbeddingSource("y".repeat(60_000)).length).toBe(
      EMBEDDING_SOURCE_LIMIT
    );
  });
});

describe("embeddingHash", () => {
  it("is stable for identical inputs", () => {
    expect(embeddingHash("abc", "model-a", 1024)).toBe(
      embeddingHash("abc", "model-a", 1024)
    );
  });

  it("changes when the text changes", () => {
    expect(embeddingHash("abc", "model-a", 1024)).not.toBe(
      embeddingHash("abd", "model-a", 1024)
    );
  });

  it("changes when the model changes", () => {
    expect(embeddingHash("abc", "model-a", 1024)).not.toBe(
      embeddingHash("abc", "model-b", 1024)
    );
  });

  it("changes when the dimension count changes", () => {
    expect(embeddingHash("abc", "model-a", 1024)).not.toBe(
      embeddingHash("abc", "model-a", 512)
    );
  });
});

/**
 * The limit exists to keep the embed call under the model's token ceiling, and
 * nothing else in the suite can say so: the ceiling is enforced by Bedrock, and
 * a test that reached it would be an integration test with a bill. So pin the
 * arithmetic the limit was chosen by instead (ADR-0037).
 *
 * This is a floor on the reasoning, not on the limit. Values up to about 21,560
 * would also clear the ceiling, so a small raise passes here; what fails on any
 * change to the number itself is the literal pinned in
 * `src/test/backfill-embeddings-parity.test.ts`. What this catches is a raise
 * that stops being defensible against the densest text the corpus holds.
 *
 * `WORST_CHARS_PER_TOKEN` is measured, not assumed: 34,487 characters of a
 * link-heavy legacy row tokenised to 13,103 tokens on 2026-09-20. The ceiling
 * belongs to one model, so the model id is asserted too rather than leaving
 * 8,192 floating free of the thing that enforces it.
 */
describe("EMBEDDING_SOURCE_LIMIT", () => {
  const TITAN_V2 = "amazon.titan-embed-text-v2:0";
  const TITAN_V2_MAX_INPUT_TOKENS = 8192;
  const WORST_CHARS_PER_TOKEN = 34_487 / 13_103;

  it("is measured against the model actually configured", () => {
    expect(EMBEDDING_MODEL_ID).toBe(TITAN_V2);
  });

  it("clears that model's token ceiling at the worst measured density", () => {
    const tokens = EMBEDDING_SOURCE_LIMIT / WORST_CHARS_PER_TOKEN;
    expect(tokens).toBeLessThan(TITAN_V2_MAX_INPUT_TOKENS);
  });
});
