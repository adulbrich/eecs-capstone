import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { getBedrockClient } from "./bedrock";
import { embeddingsEnabled } from "./embeddings-flag";

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
