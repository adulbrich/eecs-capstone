// Local development only. Run via `npm run storage:init` (uses
// tsx --env-file=.env.local), which points at the RustFS container in
// docker-compose. Idempotent: creates the bucket and applies a public-read
// policy to it. Nothing in the deployed path calls this script; production
// provisions its bucket in Terraform (`infra/s3.tf`), where public access is
// blocked and reads go through CloudFront.
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

// Public-read on GetObject so the browser can render uploaded images from
// RustFS without signed URLs. This is the local shape, not the production
// one: on AWS the bucket sets all four Block Public Access flags and its
// policy grants `s3:GetObject` to the `cloudfront.amazonaws.com` service
// principal for the assets distribution only, so `Principal: "*"` would be
// rejected there and is not what production wants.
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
  console.log(`Applied the local public-read policy to ${bucket}`);
}

async function main() {
  await ensureBucket();
  await ensurePublicRead();
}

main().then(() => process.exit(0));
