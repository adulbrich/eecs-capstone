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

export interface EmbedConfig {
  dimensions: number;
  modelId: string;
}

/**
 * Both values are hashed into `projects.embedding_source_hash` by
 * `embeddingHash`, and that hash is what decides whether a project needs
 * re-embedding. So this is not only a client setting: change what it returns
 * for a given environment and every stored hash stops matching, which silently
 * re-embeds every project at one paid Bedrock call each.
 *
 * That is why the blank case is preserved rather than tidied. `Number("")` is
 * `0`, not the default, so `BEDROCK_EMBEDDING_DIMENSIONS=""` yields dimensions
 * of zero. It is a wart, but it is the wart the stored hashes were computed
 * with. Fixing it belongs with the other config-validation questions in #137.
 */
export function buildEmbedConfig(
  env: NodeJS.ProcessEnv = process.env
): EmbedConfig {
  return {
    dimensions: Number(env.BEDROCK_EMBEDDING_DIMENSIONS ?? "1024"),
    modelId: env.BEDROCK_EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0",
  };
}

const embedConfig = buildEmbedConfig();

export const EMBEDDING_MODEL_ID = embedConfig.modelId;

export const EMBEDDING_DIMENSIONS = embedConfig.dimensions;

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
