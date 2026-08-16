import { Elysia, t } from 'elysia';
import { prisma } from '../db';
import { resolveCfIdentity } from './auth_cf';
import { ShareTooLargeError, UnsupportedShareTypeError, saveSharedFile } from '../uploads';

/**
 * `POST /api/share-target` — the Android Web Share Target landing point.
 *
 * Declared as `share_target.action` in the web manifest. Three things about it
 * are load-bearing and non-obvious:
 *
 * 1. **It authenticates by Cloudflare Access, not by a token.** Chrome delivers
 *    a share as a real browser *navigation*, so the edge injects
 *    `Cf-Access-Jwt-Assertion` exactly as it does on a page load. The user is
 *    already identified; there is nothing for a share token to add. (The iOS
 *    Shortcut needs one only because it is not a browser.)
 *
 * 2. **It must live under `/api/`.** nginx serves the SPA with
 *    `try_files $uri $uri/ /index.html`, which answers a POST with 405 — so a
 *    client-side path like `/share` could never receive this. `/api/` is
 *    proxied to this server, which is the only thing that can.
 *
 * 3. **It answers 303, not JSON.** This is a navigation: whatever comes back is
 *    what the person is looking at. A 303 sends the browser on with a GET into
 *    the SPA, which lands them in their inbox. Answering JSON would show them a
 *    page of raw JSON. 303 specifically (not 302) is what converts the POST to
 *    a GET per RFC 9110.
 *
 * Because the response is a redirect and not a rendered page, no service worker
 * is needed anywhere in this design.
 */

/** Where the browser is sent after a share. Query param opens the inbox. */
const INBOX_URL = '/?inbox=1';

/** Where the browser is sent when the share could not be stored. */
function errorUrl(reason: string): string {
  return `/?inbox=1&shareError=${encodeURIComponent(reason)}`;
}

export const shareTargetRoutes = new Elysia().post(
  '/share-target',
  async ({ headers, body, set }) => {
    const identity = await resolveCfIdentity(headers['cf-access-jwt-assertion']);

    // Every non-user outcome ends the same way: bounce into the app rather than
    // render an error document. The person just tapped "share" and is watching
    // a page load — a 401 body is not a useful thing to show them, and landing
    // in the app means an unconfigured dev host degrades to "nothing happened"
    // instead of a wall of text.
    if (identity.kind !== 'user') {
      set.status = 303;
      set.headers.location =
        identity.kind === 'kiosk'
          ? // A kiosk is a place, not a person: there is no inbox to put this in.
            errorUrl('kiosk')
          : errorUrl('auth');
      return '';
    }

    const file = body.photo ?? body.file;
    if (!file) {
      set.status = 303;
      set.headers.location = errorUrl('nofile');
      return '';
    }

    try {
      const saved = await saveSharedFile(file);
      await prisma.receiptInbox.create({
        data: {
          userId: identity.user.id,
          photoPath: saved.photoPath,
          originalPath: saved.originalPath,
          mimeType: saved.mimeType,
          filename: file.name ? file.name.slice(0, 120) : null,
          sizeBytes: saved.sizeBytes,
          source: 'android-share',
        },
      });
    } catch (error) {
      const reason =
        error instanceof ShareTooLargeError
          ? 'toolarge'
          : error instanceof UnsupportedShareTypeError
            ? 'type'
            : 'failed';
      if (reason === 'failed') {
        console.error('[share-target] store failed:', error);
      }
      set.status = 303;
      set.headers.location = errorUrl(reason);
      return '';
    }

    set.status = 303;
    set.headers.location = INBOX_URL;
    return '';
  },
  {
    /**
     * `photo` is what our own manifest declares; `file` is accepted too because
     * a share target's field name is fixed at install time — a phone that
     * installed an earlier manifest keeps POSTing the old name until the user
     * reinstalls the app, and silently dropping those shares would be a bug
     * nobody could reproduce on a fresh device.
     */
    body: t.Object({
      photo: t.Optional(t.File()),
      file: t.Optional(t.File()),
      title: t.Optional(t.String()),
      text: t.Optional(t.String()),
      url: t.Optional(t.String()),
    }),
    type: 'multipart/form-data',
  },
);
