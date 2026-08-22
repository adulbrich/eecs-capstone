import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "./bedrock";

/**
 * Embedding adapter for Amazon Titan Text Embeddings V2.
 *
 * `EmbedFn` is the injection seam: every caller takes it as a trailing default
 * parameter so tests pass a fake and never reach AWS, mirroring `ResponsesFn`
 * in bedrock-mantle.ts.
 */
export type EmbedFn = (text: string) => Promise<number[]>;

export const EMBEDDING_MODEL_ID =
  process.env.BEDROCK_EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0";

export const EMBEDDING_DIMENSIONS = Number(
  process.env.BEDROCK_EMBEDDING_DIMENSIONS ?? "1024"
);

/**
 * Kill switch. Set `BEDROCK_EMBEDDINGS_ENABLED=false` to make every embedding
 * attempt fail instantly without touching AWS.
 *
 * The integration suite sets it, because `refreshProjectEmbedding` defaults to
 * the real adapter and is reached from every publish. Without this, publishing
 * a fixture project would issue a live InvokeModel, or pay the SDK credential
 * chain's IMDS probe and retries when no credentials exist.
 *
 * It doubles as an operational switch for disabling embeddings in production
 * without a redeploy of application code.
 *
 * Read on every call, not captured once at import. As a module-level `const`
 * this depended on import order and on nothing replacing `process.env`, and a
 * kill switch that can fail open by accident is not a kill switch. When it
 * does fail open under test there is no fast error: the call reaches the AWS
 * SDK, which walks the credential chain and pays an IMDS probe with retries,
 * which is seconds per call rather than a clean failure.
 */
export function embeddingsEnabled(): boolean {
  return process.env.BEDROCK_EMBEDDINGS_ENABLED !== "false";
}

export function buildEmbedRequestBody(text: string): string {
  return JSON.stringify({
    inputText: text,
    dimensions: EMBEDDING_DIMENSIONS,
    normalize: true,
  });
}

export function parseEmbedResponse(payload: Uint8Array): number[] {
  const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
    embedding?: number[];
  };
  if (!Array.isArray(parsed.embedding)) {
    throw new Error("Bedrock returned no embedding");
  }
  return parsed.embedding;
}

export const bedrockEmbed: EmbedFn = async (text) => {
  if (!embeddingsEnabled()) {
    throw new Error("Embeddings are disabled (BEDROCK_EMBEDDINGS_ENABLED)");
  }
  const response = await getBedrockClient().send(
    new InvokeModelCommand({
      modelId: EMBEDDING_MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: buildEmbedRequestBody(text),
    })
  );
  return parseEmbedResponse(response.body);
};
