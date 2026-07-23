import { describe, expect, it } from "vitest";
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
    const source = buildProjectEmbeddingSource(project, [], null);
    expect(source).toContain("Autonomous Rover Telemetry");
    expect(source).toContain("streams sensor data");
    expect(source).toContain("collected by hand");
    expect(source).toContain("ingest pipeline");
    expect(source).toContain("C and Python");
    expect(source).toContain("Prior robotics work");
    expect(source).toContain("MIT");
  });

  it("includes category names and the program label", () => {
    const source = buildProjectEmbeddingSource(
      project,
      ["Robotics", "Embedded"],
      "CS 461 Capstone"
    );
    expect(source).toContain("Robotics");
    expect(source).toContain("Embedded");
    expect(source).toContain("CS 461 Capstone");
  });

  it("omits empty fields rather than emitting bare labels", () => {
    const source = buildProjectEmbeddingSource(
      { ...project, objectives: null, licenseRestrictions: null },
      [],
      null
    );
    expect(source).not.toContain("Objectives:");
    expect(source).not.toContain("License:");
  });

  it("truncates at the source limit", () => {
    const source = buildProjectEmbeddingSource(
      { ...project, description: "x".repeat(60_000) },
      [],
      null
    );
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
