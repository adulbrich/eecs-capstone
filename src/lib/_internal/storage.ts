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
  const client = new S3Client(buildS3Config());
  _instance = new S3Storage(process.env.S3_BUCKET ?? "cs-capstone", client);
  return _instance;
}
