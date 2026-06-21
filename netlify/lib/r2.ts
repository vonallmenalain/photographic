import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type PhotoVariant = "original" | "preview" | "thumb";

let client: S3Client | null = null;

function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

export function getR2Client(): S3Client {
  if (client) {
    return client;
  }

  client = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT ?? `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY")
    }
  });

  return client;
}

export function getPhotoObjectKey(photoId: string, variant: PhotoVariant): string {
  return `photos/${photoId}/${variant}`;
}

export async function createPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env("R2_BUCKET_NAME"),
    Key: key,
    ContentType: contentType
  });

  return getSignedUrl(getR2Client(), command, { expiresIn: 300 });
}

export async function createPresignedReadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env("R2_BUCKET_NAME"),
    Key: key
  });

  return getSignedUrl(getR2Client(), command, { expiresIn: 120 });
}
