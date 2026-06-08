import {
  BedrockRuntimeClient,
  type BedrockRuntimeClientConfig,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

const DEFAULT_REGION = "us-east-1";

/**
 * Builds the Bedrock client config from the environment.
 *
 * In production no static keys are set, so we omit `credentials` and let
 * the SDK's default chain use the ECS **task role**. Static keys are only
 * included when present (e.g., a developer running against Bedrock locally).
 */
export function buildBedrockConfig(
  env: NodeJS.ProcessEnv = process.env
): BedrockRuntimeClientConfig {
  const accessKeyId = env.BEDROCK_ACCESS_KEY;
  const secretAccessKey = env.BEDROCK_SECRET_KEY;
  return {
    region: env.BEDROCK_REGION ?? DEFAULT_REGION,
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  };
}

let _client: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
  if (_client) {
    return _client;
  }
  _client = new BedrockRuntimeClient(buildBedrockConfig());
  return _client;
}

export type ConverseFn = (
  input: ConverseCommandInput
) => Promise<ConverseCommandOutput>;

export const bedrockConverse: ConverseFn = (input) =>
  getBedrockClient().send(new ConverseCommand(input));
