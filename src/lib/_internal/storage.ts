import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

const DEFAULT_REGION = "us-east-1";

/**
 * Builds the S3 client config from the environment.
 *
 * Locally we talk to RustFS via a custom `S3_ENDPOINT` with static keys.
 * In production no `S3_ENDPOINT`/keys are set, so we omit `credentials`
 * entirely and let the SDK's default chain pick up the ECS **task role**.
 * Passing empty-string credentials (the previous behavior) would defeat
 * the task role, so the keys are only included when actually present.
 */
export function buildS3Config(
  env: NodeJS.ProcessEnv = process.env
): S3ClientConfig {
  const endpoint = env.S3_ENDPOINT;
  const accessKeyId = env.S3_ACCESS_KEY;
  const secretAccessKey = env.S3_SECRET_KEY;
  return {
    region: env.S3_REGION ?? DEFAULT_REGION,
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    ...(accessKeyId && secretAccessKey
      ? { credentials: { accessKeyId, secretAccessKey } }
      : {}),
  };
}

export interface StorageConfig {
  bucket: string;
  clientConfig: S3ClientConfig;
}

/**
 * `buildS3Config` stays separate and exported because its return type is the
 * SDK's own `S3ClientConfig`, which has no room for a bucket name. This is the
 * pairing of the two, so the bucket stops being the one storage variable read
 * inline at the point of use.
 */
export function buildStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): StorageConfig {
  return {
    bucket: env.S3_BUCKET ?? "cs-capstone",
    clientConfig: buildS3Config(env),
  };
}

export interface ObjectStorage {
  delete(key: string): Promise<void>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

class S3Storage implements ObjectStorage {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(bucket: string, client: S3Client) {
    this.bucket = bucket;
    this.client = client;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }
}

let _instance: ObjectStorage | null = null;

export function getObjectStorage(): ObjectStorage {
  if (_instance) {
    return _instance;
  }
  const config = buildStorageConfig();
  _instance = new S3Storage(config.bucket, new S3Client(config.clientConfig));
  return _instance;
}

/**
 * The keys one row's images live under, and the only way to mint a new one.
 *
 * Both halves together on purpose. The delete below refuses any key outside
 * the space, so a key layout that changed in the builder but not at the delete
 * site would turn cleanup into a permanent silent no-op. Handing out one
 * object means there is no second spelling to forget.
 */
export interface KeySpace {
  newKey(): string;
  readonly prefix: string;
}

function keySpace(prefix: string): KeySpace {
  return { prefix, newKey: () => `${prefix}${randomUUID()}.webp` };
}

export const projectImageKeys = (projectId: string): KeySpace =>
  keySpace(`projects/${projectId}/`);

export const avatarKeys = (userId: string): KeySpace =>
  keySpace(`avatars/${userId}/`);

/**
 * Deletes an object a column has stopped pointing at.
 *
 * Best effort by design: an object that outlives its row costs storage, while
 * a delete that throws would fail a write that has already committed. So this
 * never rejects, and callers await it only so a test can assert on the result
 * rather than race it.
 *
 * A key outside the row's own space is left alone, and that guard is the point
 * rather than a detail: `imageUrl` is an ordinary client-writable column, so
 * without it a caller could point their own row at another row's key and have
 * the next save destroy an object they never had access to. Legacy absolute
 * `http(s)://` values fail the same check, which is what the hand-rolled skip
 * at each old call site was for.
 *
 * Not deleting is always the safe direction here: the cost is an orphan, and
 * the cost of the other direction is someone else's image.
 */
export async function deleteReplacedObject(
  key: string | null | undefined,
  space: KeySpace
): Promise<void> {
  if (!key?.startsWith(space.prefix)) {
    return;
  }
  try {
    await getObjectStorage().delete(key);
  } catch (e) {
    console.warn(`Failed to delete replaced object ${key}:`, e);
  }
}
