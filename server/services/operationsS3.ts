import { S3Client } from "@aws-sdk/client-s3";

export const DOCUMENTS_BUCKET = "factorflux-documents-tpf";
// The SDK's standard credential chain uses the existing AWS environment secrets.
export const operationsS3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-2",
  maxAttempts: 2,
});
