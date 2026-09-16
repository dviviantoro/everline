import { randomUUID } from "crypto";
import { S3Client, PutObjectCommand, HeadBucketCommand, CreateBucketCommand, PutBucketPolicyCommand } from "@aws-sdk/client-s3";

const BUCKET = process.env.S3_BUCKET || "pd-photos";
const endpoint = process.env.S3_ENDPOINT; // e.g. http://minio:9000 (internal, Docker network)
const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL; // e.g. https://api.yourdomain.com/storage — reverse-proxied to MinIO by Caddy

if (!endpoint || !process.env.S3_ACCESS_KEY || !process.env.S3_SECRET_KEY || !publicBaseUrl) {
  throw new Error(
    "Missing S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_PUBLIC_BASE_URL — set them in backend/.env"
  );
}

const s3 = new S3Client({
  endpoint,
  region: "us-east-1", // MinIO ignores region, the SDK still requires one
  forcePathStyle: true, // required for MinIO (path-style, not virtual-hosted-style)
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
});

/** Creates the pd-photos bucket with a public-read policy if it doesn't exist yet. Called once at startup. */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
    return;
  } catch {
    // falls through to create — HeadBucket throws on 404
  }
  await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${BUCKET}/*`],
      },
    ],
  };
  await s3.send(new PutBucketPolicyCommand({ Bucket: BUCKET, Policy: JSON.stringify(policy) }));
}

/**
 * Uploads a PD measurement photo to MinIO and returns its public URL. Unlike
 * the old Supabase Storage setup, storage credentials never reach the
 * browser — the frontend posts the file to this backend's /api/uploads,
 * which is the only thing that talks to MinIO directly.
 */
export async function uploadPdPhoto(buffer: Buffer, originalName: string, contentType: string): Promise<string> {
  const ext = originalName.split(".").pop() || "jpg";
  const key = `${randomUUID()}.${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType || "image/jpeg",
    })
  );

  return `${publicBaseUrl!.replace(/\/$/, "")}/${BUCKET}/${key}`;
}
