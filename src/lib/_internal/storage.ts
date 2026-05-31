import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface ObjectStorage {
  delete(key: string): Promise<void>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
}

class S3Storage implements ObjectStorage {
  constructor(
    private readonly bucket: string,
    private readonly client: S3Client
  ) {}

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
  const endpoint = process.env.S3_ENDPOINT;
  const client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint,
    forcePathStyle: !!endpoint,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? "",
      secretAccessKey: process.env.S3_SECRET_KEY ?? "",
    },
  });
  _instance = new S3Storage(process.env.S3_BUCKET ?? "cs-capstone", client);
  return _instance;
}
