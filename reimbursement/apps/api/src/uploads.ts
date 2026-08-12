import { mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

const UPLOADS_DIR = join(process.cwd(), 'uploads');
const PUBLIC_PREFIX = '/uploads';

/**
 * Extensions are the only part of an uploaded name we keep, and they come from
 * outside — a browser file picker, or a filename the KBIZ bot chose. Anything
 * that is not a short alphanumeric suffix becomes `.bin`, so the stored name
 * always matches the `[A-Za-z0-9._-]` allowlist the /uploads route enforces.
 */
const SAFE_EXTENSION = /^\.[A-Za-z0-9]{1,8}$/;

/**
 * Persist bytes under `apps/api/uploads/{uuid}{ext}` and return the public URL
 * path the /uploads route will serve them from.
 *
 * Filenames use `crypto.randomUUID()` to avoid collisions; the caller's
 * extension is preserved when it is safe, and defaults to .bin otherwise.
 */
async function persist(data: Blob, extension: string): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });

  const safeExtension = SAFE_EXTENSION.test(extension) ? extension : '.bin';
  const filename = `${crypto.randomUUID()}${safeExtension}`;
  const absolutePath = join(UPLOADS_DIR, filename);

  await Bun.write(absolutePath, data);

  return `${PUBLIC_PREFIX}/${filename}`;
}

/** Save a multipart upload (a receipt photo, a transfer slip). */
export async function saveUploadedFile(file: File): Promise<string> {
  return persist(file, extname(file.name).toLowerCase());
}

/**
 * Save bytes this app fetched itself rather than received over HTTP — today the
 * e-slip the KBIZ bot captured in the shared queue dir.
 *
 * It goes through the same uploads directory as a manually attached slip on
 * purpose: `transferProofPath` then sits behind the same Cloudflare-identity
 * gate whichever way the payment was made, and the shared queue dir stays a
 * transport, not a second place where proof of payment lives.
 */
export async function saveUploadedBytes(data: Blob, extension: string): Promise<string> {
  return persist(data, extension.toLowerCase());
}
