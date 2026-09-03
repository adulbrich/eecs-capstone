// Run via `npm run storage:init` (uses tsx --env-file=.env.local).
// Idempotent: creates the bucket and applies a public-read policy.
import {
  CreateBucketCommand,
  PutBucketPolicyCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const endpoint = process.env.S3_ENDPOINT;
// No default, and blank counts as unset, same as buildStorageConfig: a bucket
// named by a fallback is a bucket nobody chose. .env.example sets it for the
// local stack.
const bucket = process.env.S3_BUCKET?.trim();
if (!bucket) {
  throw new Error("S3_BUCKET environment variable is not set");
}

const client = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint,
  forcePathStyle: !!endpoint,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "",
  },
});

// Public-read on GetObject so the browser can render uploaded images
// without signed URLs. Same policy works on AWS S3; on AWS you also need
// to disable Block Public Access at the bucket level (or use a CDN).
const publicReadPolicy = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PublicReadGetObject",
      Effect: "Allow",
      Principal: "*",
      Action: ["s3:GetObject"],
      Resource: [`arn:aws:s3:::${bucket}/*`],
    },
  ],
};

async function ensureBucket() {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Created bucket ${bucket}`);
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (name === "BucketAlreadyOwnedByYou" || name === "BucketAlreadyExists") {
      console.log(`Bucket ${bucket} already exists`);
      return;
    }
    throw err;
  }
}

async function ensurePublicRead() {
  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify(publicReadPolicy),
    }),
  );
  console.log(`Applied public-read policy to ${bucket}`);
}

async function main() {
  await ensureBucket();
  await ensurePublicRead();
}

main().then(() => process.exit(0));
