import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { INVALID_IMAGE } from "#/lib/image-upload-policy";

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
 * The keys one row's images live under, the only way to mint a new one, and
 * the only test for whether a key belongs here.
 *
 * All three together on purpose. Both the delete below and the write guard
 * refuse any key outside the space, so a key layout that changed in the
 * builder but not at either check would turn cleanup into a permanent silent
 * no-op and let a caller write a key the row does not own. Handing out one
 * object means there is no second spelling to forget.
 */
export interface KeySpace {
  newKey(): string;
  owns(key: string): boolean;
  readonly prefix: string;
}

/**
 * One plain filename directly under the prefix: letters, digits, underscore or
 * hyphen, one dot, an alphanumeric extension. Looser than the `<uuid>.webp`
 * `newKey` mints, because a key that names nothing in the bucket is a broken
 * image rather than a leak, so demanding a uuid buys nothing and would force
 * every test to mint one to say anything.
 *
 * What it does buy is one honest meaning for "inside this space".
 * `startsWith(prefix)` accepts `projects/<own-id>/../<other-id>/x.webp`, which
 * is a distinct key in S3 so it destroys nothing, and it is not the
 * third-party fetch #162 is about either: it renders ANOTHER row's image out
 * of this app's own bucket, because a browser normalizes the path. A content
 * integrity nit on its own, but it means the prefix alone does not mean what
 * it looks like it means, and both call sites read this one predicate.
 */
const OWNED_FILENAME = /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/;

function keySpace(prefix: string): KeySpace {
  return {
    prefix,
    newKey: () => `${prefix}${randomUUID()}.webp`,
    owns: (key) =>
      key.startsWith(prefix) && OWNED_FILENAME.test(key.slice(prefix.length)),
  };
}

export const projectImageKeys = (projectId: string): KeySpace =>
  keySpace(`projects/${projectId}/`);

export const avatarKeys = (userId: string): KeySpace =>
  keySpace(`avatars/${userId}/`);

export const inventoryImageKeys = (itemId: string): KeySpace =>
  keySpace(`inventory/${itemId}/`);

/**
 * Deletes an object the row that owns it has stopped pointing at, whether
 * because a new key replaced it or because the row itself is gone.
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
export async function deleteOwnedObject(
  key: string | null | undefined,
  space: KeySpace
): Promise<void> {
  if (!(key && space.owns(key))) {
    return;
  }
  try {
    await getObjectStorage().delete(key);
  } catch (e) {
    console.warn(`Failed to delete object ${key}:`, e);
  }
}

/**
 * Refuses an image key a row is not allowed to point at.
 *
 * The write-path twin of the guard `deleteOwnedObject` already applies, and it
 * exists because that guard only ever protected the OTHER row's object. What
 * the column may CONTAIN was unchecked beyond a length, so any signed-in user
 * could set a project's `imageUrl` to a URL they control and have every viewer
 * of that project, a reviewing staff member above all, fetch it. See #162.
 *
 * Empty is always allowed: clearing the image is an ordinary edit.
 *
 * Callers apply this only when the value CHANGES, which is what keeps rows
 * holding a legacy absolute URL editable. Those predate the upload flow and
 * still render, by design in `getPublicUrl`; this stops new ones, it does not
 * remediate old ones.
 */
export function assertOwnedKey(
  key: string | null | undefined,
  space: KeySpace
): void {
  if (key && !space.owns(key)) {
    throw new Error(INVALID_IMAGE);
  }
}
