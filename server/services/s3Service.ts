import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.AWS_S3_BUCKET;
const REGION = process.env.AWS_REGION || "us-east-2";

function getClient(): S3Client {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not configured");
  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
}

export async function uploadToS3(
  buffer: Buffer,
  key: string,
  mimeType: string
): Promise<string> {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not configured");
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );
  return key;
}

export async function getSignedViewUrl(key: string): Promise<string> {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not configured");
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: "inline",
    }),
    { expiresIn: 3600 }
  );
}

export async function getSignedDownloadUrl(
  key: string,
  filename: string
): Promise<string> {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not configured");
  const client = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: 3600 }
  );
}

export async function deleteFromS3(key: string): Promise<void> {
  try {
    if (!BUCKET) throw new Error("AWS_S3_BUCKET is not configured");
    const client = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch (err) {
    console.error("[S3] Failed to delete object:", key, err);
  }
}

export async function deleteFromS3Strict(key: string): Promise<void> {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not configured");
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

export async function downloadToTemp(key: string, destPath: string): Promise<void> {
  if (!BUCKET) throw new Error("AWS_S3_BUCKET is not configured");
  const { createWriteStream } = await import("fs");
  const { Readable } = await import("stream");
  const client = getClient();
  const { Body } = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  if (!Body) throw new Error(`[S3] Empty body for key: ${key}`);
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(destPath);
    (Body as Readable).pipe(writeStream);
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });
}
