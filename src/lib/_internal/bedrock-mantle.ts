import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";

const DEFAULT_REGION = "us-east-1";

/**
 * SigV4 signs against the endpoint's own service name, and Mantle's is
 * `bedrock-mantle`, not `bedrock`. Signing as `bedrock` yields a
 * well-formed signature that the endpoint rejects, which reads as an IAM
 * problem rather than a signing one. The IAM actions are namespaced the same
 * way: this endpoint authorizes `bedrock-mantle:CreateInference`, which
 * `bedrock:InvokeModel` does not cover.
 */
const SIGNING_SERVICE = "bedrock-mantle";

/**
 * GPT-5.6 is served under `/openai/v1` on Mantle rather than the endpoint's
 * default `/v1`, so the path is not interchangeable between models.
 */
export const RESPONSES_PATH = "/openai/v1/responses";

export function mantleRegion(env: NodeJS.ProcessEnv = process.env): string {
  return env.BEDROCK_REGION ?? DEFAULT_REGION;
}

export function mantleHost(region: string): string {
  return `bedrock-mantle.${region}.api.aws`;
}

/**
 * Static keys when a developer has them set, otherwise the SDK's default
 * chain, which on ECS resolves the task role. Mirrors `buildBedrockConfig`
 * for the bedrock-runtime client, except that a raw signed fetch has to
 * resolve credentials itself instead of letting a client do it.
 */
function credentialProvider(env: NodeJS.ProcessEnv = process.env) {
  const accessKeyId = env.BEDROCK_ACCESS_KEY;
  const secretAccessKey = env.BEDROCK_SECRET_KEY;
  if (accessKeyId && secretAccessKey) {
    return () => Promise.resolve({ accessKeyId, secretAccessKey });
  }
  return defaultProvider();
}

/** One output item from the Responses API. */
export interface MantleOutputItem {
  arguments?: string;
  content?: MantleOutputItem[];
  name?: string;
  type?: string;
}

/** Token counts as the Responses API reports them. */
/**
 * The docs disagree about where a function call lands: the Responses API spec
 * puts it at the top level of `output`, while the Bedrock tool-use guide reads
 * it out of an item's `content`. Look in both rather than pick a side. Shared
 * by the review and the scope assessment, which each declare their own tool.
 */
export function findToolCall(
  items: MantleOutputItem[],
  toolName: string
): MantleOutputItem | undefined {
  for (const item of items) {
    if (item.type === "function_call" && item.name === toolName) {
      return item;
    }
    const nested = item.content && findToolCall(item.content, toolName);
    if (nested) {
      return nested;
    }
  }
  return;
}

export interface MantleUsage {
  input_tokens?: number;
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface MantleResponse {
  incomplete_details?: { reason?: string };
  output?: MantleOutputItem[];
  status?: string;
  usage?: MantleUsage;
}

/**
 * Injection seam, as `EmbedFn` is for embeddings: every caller takes it as a
 * trailing default parameter so tests pass a fake and never reach AWS.
 */
export type ResponsesFn = (
  body: Record<string, unknown>
) => Promise<MantleResponse>;

let _signer: SignatureV4 | null = null;

/**
 * Takes no region: a signer binds the region into its credential scope at
 * construction, so a cached one cannot honour a different region later. It
 * reads the same env the host does, which keeps the two from drifting.
 */
function getSigner(): SignatureV4 {
  if (_signer) {
    return _signer;
  }
  _signer = new SignatureV4({
    credentials: credentialProvider(),
    region: mantleRegion(),
    service: SIGNING_SERVICE,
    sha256: Sha256,
  });
  return _signer;
}

/**
 * Calls the OpenAI-compatible Responses API on the bedrock-mantle endpoint.
 *
 * There is no AWS SDK client for this endpoint, so this signs a plain fetch.
 * Using the OpenAI SDK instead would mean a long-lived Bedrock API key in the
 * task definition; SigV4 keeps production on the ECS task role and leaves the
 * app with no model credential of its own.
 */
export const mantleResponses: ResponsesFn = async (body) => {
  const region = mantleRegion();
  const hostname = mantleHost(region);
  const payload = JSON.stringify(body);
  const signed = await getSigner().sign({
    body: payload,
    headers: { "content-type": "application/json", host: hostname },
    hostname,
    method: "POST",
    path: RESPONSES_PATH,
    protocol: "https:",
    query: {},
  });
  const response = await fetch(`https://${hostname}${RESPONSES_PATH}`, {
    body: payload,
    headers: signed.headers,
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `Bedrock Mantle returned ${response.status}: ${await response.text()}`
    );
  }
  return (await response.json()) as MantleResponse;
};
