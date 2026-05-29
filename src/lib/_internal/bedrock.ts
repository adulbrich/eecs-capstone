import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
} from "@aws-sdk/client-bedrock-runtime";

let _client: BedrockRuntimeClient | null = null;

export function getBedrockClient(): BedrockRuntimeClient {
  if (_client) return _client;
  _client = new BedrockRuntimeClient({
    region: process.env.BEDROCK_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.BEDROCK_ACCESS_KEY ?? "",
      secretAccessKey: process.env.BEDROCK_SECRET_KEY ?? "",
    },
  });
  return _client;
}

export type ConverseFn = (
  input: ConverseCommandInput,
) => Promise<ConverseCommandOutput>;

export const bedrockConverse: ConverseFn = (input) =>
  getBedrockClient().send(new ConverseCommand(input));
