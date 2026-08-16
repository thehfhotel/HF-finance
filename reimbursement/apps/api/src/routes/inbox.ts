import { Elysia } from 'elysia';
import { auth } from '../auth';
import { prisma } from '../db';
import { serializeInboxItem } from '../serializers';
import {
  MAX_SHARED_FILE_BYTES,
  ShareTooLargeError,
  UnsupportedShareTypeError,
  fileFromRawBody,
  saveSharedFile,
} from '../uploads';
import { resolveShareToken } from '../share_tokens';

/**
 * The share inbox — files that arrived from a phone and are waiting to become
 * Receipts.
 *
 * Three producers, one queue:
 *   POST /api/inbox/quick    ← iOS Shortcut, share-token auth (no browser)
 *   POST /api/share-target   ← Android Web Share Target, Cloudflare Access auth
 *   (a later kiosk/email producer would be a third, with no change here)
 *
 * and one consumer: the employee, in `GET /api/inbox`, draining an item into
 * the ordinary receipt form.
 *
 * Note the asymmetric auth. The Android path is a *browser navigation*, so
 * Cloudflare injects `Cf-Access-Jwt-Assertion` exactly as it does on a page
 * load and the user is already identified — no token needed. Only the iOS
 * Shortcut, which is not a browser and holds no Access session, needs a
 * long-lived credential. See CR-2026-08-16.
 */

// ─── The employee-facing half (ordinary session auth) ────────────────────────

export const inboxRoutes = new Elysia({ prefix: '/inbox' })
  .use(auth)

  /** My inbox, newest first. Never another employee's — `userId` is from the session. */
  .get('/', async ({ user }) => {
    const items = await prisma.receiptInbox.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return items.map(serializeInboxItem);
  })

  /**
   * Discard an item without making a receipt of it.
   *
   * `userId` is in the WHERE clause rather than checked after the read, so one
   * employee cannot delete another's item by guessing an id. The uploaded file
   * is deliberately left on disk: the uploads volume is already append-only in
   * practice (receipts reference files forever), and unlinking here would be
   * the one code path that deletes user data on a DELETE that the employee may
   * well have meant as "not now".
   */
  .delete('/:id', async ({ user, params, status }) => {
    const { count } = await prisma.receiptInbox.deleteMany({
      where: { id: params.id, userId: user.id },
    });
    if (count === 0) return status(404, { message: 'Inbox item not found' });
    return { ok: true };
  });

// ─── The phone-facing half (share-token auth, no session) ────────────────────

/**
 * `POST /api/inbox/quick` — the iOS Shortcut's endpoint.
 *
 * A separate Elysia instance because it must NOT mount the `auth` plugin: the
 * caller has no app session and no Cloudflare Access cookie, only a share
 * token. Everything it can do is create one row owned by that token's user.
 *
 * In production this path also sits behind a path-scoped Cloudflare Access app
 * with a service-token policy, so the share token is the second of two gates,
 * not the only one.
 */
export const inboxQuickRoutes = new Elysia({ prefix: '/inbox' }).post(
  '/quick',
  async ({ headers, body, request, status, set }) => {
    const authz = headers.authorization;
    if (!authz?.startsWith('Bearer ')) {
      return status(401, { message: 'Missing Authorization: Bearer header' });
    }

    const user = await resolveShareToken(authz.slice('Bearer '.length).trim());
    if (!user) {
      // One message for unknown, revoked and malformed alike — the API must not
      // be an oracle for which tokens once existed.
      return status(401, { message: 'Invalid share token' });
    }

    /**
     * TWO body shapes, because the iPhone Shortcuts UI makes one of them much
     * easier to get right than the other:
     *
     *   multipart/form-data with a `photo` field — the Form recipe, and what
     *     any ordinary client sends.
     *   a raw body — Shortcuts' `Request Body: File`, which posts the bytes
     *     with the file's own Content-Type. One value, no field name, no field
     *     type to choose, so there is nothing to put in the wrong box.
     *
     * The dispatch is safe because of how Elysia actually behaves (verified,
     * not assumed): for multipart it parses into `body` and the underlying
     * request stream is already consumed; for any other content type it leaves
     * `body` undefined and the stream readable. So checking `body` first and
     * falling back to the raw stream never double-reads.
     */
    let file: File | null = null;
    let source = 'ios-share';

    const parsed = body as { photo?: File; source?: string } | undefined;
    if (parsed && typeof parsed === 'object' && parsed.photo instanceof File) {
      file = parsed.photo;
      if (typeof parsed.source === 'string') source = parsed.source.slice(0, 32);
    } else {
      const raw = await request.arrayBuffer();
      file = fileFromRawBody(raw, headers['content-type'], headers['content-disposition']);
    }

    if (!file) {
      return status(400, {
        message:
          'Missing photo — send multipart/form-data with a `photo` field, or the file as the raw request body',
      });
    }

    let saved;
    try {
      saved = await saveSharedFile(file);
    } catch (error) {
      if (error instanceof ShareTooLargeError) {
        return status(413, {
          message: `File too large (max ${Math.floor(MAX_SHARED_FILE_BYTES / (1024 * 1024))} MB)`,
        });
      }
      if (error instanceof UnsupportedShareTypeError) {
        return status(415, { message: `Unsupported file type: ${error.mimeType}` });
      }
      throw error;
    }

    const item = await prisma.receiptInbox.create({
      data: {
        userId: user.id,
        photoPath: saved.photoPath,
        originalPath: saved.originalPath,
        mimeType: saved.mimeType,
        // Untrusted: display only. uploads.ts always generates its own path.
        filename: file.name ? file.name.slice(0, 120) : null,
        sizeBytes: saved.sizeBytes,
        source,
      },
    });

    set.status = 201;
    return serializeInboxItem(item);
  },
  // Deliberately NO body schema and no `type`: declaring multipart here made
  // Elysia reject a raw body outright, which is exactly the shape the simpler
  // Shortcut sends. Validation happens in the handler instead.
);
