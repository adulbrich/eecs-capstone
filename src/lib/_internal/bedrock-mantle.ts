import { Sha256 } from "@aws-crypto/sha256-js";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";
import { errorMessage } from "#/lib/error-message";

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

/**
 * The values Mantle accepts for `reasoning.effort`, in the order its own 400
 * lists them.
 *
 * Not the OpenAI set, and the difference has already cost a production
 * outage: `minimal` is valid against the OpenAI API and rejected here, so the
 * social summary shipped on 2026-09-21 failing every call. Nothing caught it,
 * because the unit tests mock this endpoint and the value production actually
 * uses comes from `infra/variables.tf` rather than from any default in `src`.
 * `reasoning-effort-contract.test.ts` now checks both against this list.
 */
export const MANTLE_REASONING_EFFORTS = [
  "none",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

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
}

/** Token counts as the Responses API reports them. */
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
 * Without it a stalled call waits out undici's 300 s header timeout, which is
 * how a save once sat on "Saving..." (ADR-0053). It caps every caller: the
 * slowest save, AI review and scope assessment in the week before took 2.3 s,
 * 4.5 s and 5.3 s, so this cuts a stall rather than a slow answer.
 */
const MANTLE_TIMEOUT_MS = 60_000;

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
  let response: Response;
  try {
    response = await fetch(`https://${hostname}${RESPONSES_PATH}`, {
      body: payload,
      headers: signed.headers,
      method: "POST",
      signal: AbortSignal.timeout(MANTLE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Bedrock Mantle request failed: ${fetchFailureReason(error)}`,
      { cause: error }
    );
  }
  if (!response.ok) {
    const text = await readResponse(() => response.text());
    throw new Error(`Bedrock Mantle returned ${response.status}: ${text}`);
  }
  return (await readResponse(() => response.json())) as MantleResponse;
};

/** A body that dies mid-read names its cause the same way a failed fetch does. */
async function readResponse<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    throw new Error(
      `Bedrock Mantle response failed: ${fetchFailureReason(error)}`,
      { cause: error }
    );
  }
}

/**
 * What a failed fetch actually hit. undici rejects with a bare "fetch failed"
 * and puts the reason, a code such as `ECONNREFUSED`, `ENOTFOUND` or
 * `UND_ERR_SOCKET`, on `cause`, which every log line here used to drop: the
 * stall behind ADR-0053 left nothing but "fetch failed" to diagnose. Our own
 * timeout is a `TimeoutError` with no cause, and reads as its message alone.
 * A host whose every address refuses gives an `AggregateError` with an empty
 * message, so the first of its errors speaks for it.
 */
export function fetchFailureReason(error: unknown): string {
  const message = errorMessage(error, "fetch failed");
  const cause = error instanceof Error ? error.cause : undefined;
  if (!(cause instanceof Error)) {
    return message;
  }
  const code = (cause as { code?: unknown }).code;
  const detail =
    cause.message ||
    (cause instanceof AggregateError ? errorMessage(cause.errors[0], "") : "");
  return `${message} (${typeof code === "string" ? code : cause.name}: ${detail})`;
}
