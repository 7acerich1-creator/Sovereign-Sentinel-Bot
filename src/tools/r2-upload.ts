// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// R2 Upload Utility — Cloudflare R2 via S3-compatible API
//
// Used by vidrush-orchestrator to upload clip videos + thumbnails.
// R2 env vars are the same ones forwarded to the pod (runpod-client.ts:73-78).
// Zero egress fees — no cleanup needed (unlike old Supabase Storage path).
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ── Env vars (same keys Railway forwards to the pod) ──
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_PUBLIC_URL_BASE = process.env.R2_PUBLIC_URL_BASE; // e.g. pub-0ae5dfb3341f45418f0d28e0a2d89c41.r2.dev

/** Whether R2 is fully configured on this Railway instance */
export function isR2Configured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_PUBLIC_URL_BASE);
}

/** Lazily instantiated S3 client for Cloudflare R2 */
let _client: S3Client | null = null;
function getClient(): S3Client {
  if (!_client) {
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error("R2 env vars missing (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
    }
    _client = new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _client;
}

export interface R2UploadResult {
  /** Full public URL for the uploaded object */
  publicUrl: string;
  /** The key used inside the bucket */
  key: string;
}

/**
 * Upload a buffer to Cloudflare R2 and return the public URL.
 *
 * @param bucket   - R2 bucket name (e.g. "sovereign-videos")
 * @param key      - Object key / path inside the bucket (e.g. "clips/ace_richie_quantum/clip_01.mp4")
 * @param body     - File contents as Buffer
 * @param contentType - MIME type (e.g. "video/mp4", "image/jpeg")
 * @param retries  - Max retry attempts on failure (default 3)
 */
export async function uploadToR2(
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  retries = 3,
): Promise<R2UploadResult> {
  const client = getClient();

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );

      const publicUrl = `https://${R2_PUBLIC_URL_BASE}/${key}`;
      return { publicUrl, key };
    } catch (err: any) {
      lastError = err;
      if (attempt < retries) {
        const backoffMs = 3000 * Math.pow(2, attempt - 1); // 3s, 6s
        console.warn(
          `⚠️ [R2] Upload attempt ${attempt}/${retries} failed for ${key}: ${err.message?.slice(0, 150)}. Retry in ${backoffMs / 1000}s`,
        );
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(`R2 upload failed after ${retries} attempts for ${key}: ${lastError?.message}`);
}
