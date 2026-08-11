/**
 * Push a notification into the HF One portal's notification centre.
 *
 * The portal owns notifications for the whole estate — the bell, the device
 * registrations, the manager set — and exposes `POST /portal-api/notify` for
 * other apps to feed it, bearer-authenticated. So this app does not build its
 * own: it hands the portal an event and lets it decide whose phone rings.
 *
 * Two rules matter here:
 *
 *  1. FIRE AND FORGET. A failed notification must never fail the thing that
 *     triggered it. Someone submitting an expense has done nothing wrong if the
 *     portal is down, and turning that into a 500 would lose their work.
 *     Everything is caught, logged, and swallowed.
 *
 *  2. DARK WHEN UNCONFIGURED. No token, no notification — the same posture as
 *     CF_ACCESS_AUD, READER_RESOLVE_SECRET and KIOSK_EMAILS. A dev machine
 *     never pages anyone by accident.
 */

const NOTIFY_TOKEN = process.env.NOTIFY_INGRESS_TOKEN;
// The portal over the LAN, not its public hostname.
//
// erp.thehfhotel.org sits behind Cloudflare Access, and this container holds no
// Access session — a POST there is answered with a 302 to a login page, so the
// notification silently never arrives. Reaching the container directly bypasses
// the wall the same way HF_ID_BASE_URL already does for the card-login calls.
// Verified: the LAN endpoint accepts our bearer token (400 "title and body
// required" on an empty body, rather than 401 or a redirect).
const HF_ERP_BASE_URL = (process.env.HF_ERP_BASE_URL ?? 'http://192.168.100.228:4020').replace(
  /\/+$/,
  '',
);
/** Where a notification should take the reader. */
const WEB_BASE_URL = (process.env.WEB_BASE_URL ?? 'https://reimbursement.thehfhotel.org').replace(
  /\/+$/,
  '',
);

/** Portal-side timeout — a slow bell must not hold an API response open. */
const NOTIFY_TIMEOUT_MS = 4000;

export interface NotifyInput {
  title: string;
  body: string;
  /** Deep link, relative to this app (e.g. '/'), or absolute. */
  path?: string;
  /** Dedupe key; the portal collapses repeats of the same tag. */
  tag?: string;
  /** 'managers' reaches only people who can act. Omit for everyone. */
  audience?: 'managers';
}

export function notifyPortal(input: NotifyInput): void {
  if (!NOTIFY_TOKEN) return; // feature dark

  // Deliberately not awaited by callers — see rule 1 above.
  void (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
      try {
        const res = await fetch(`${HF_ERP_BASE_URL}/portal-api/notify`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${NOTIFY_TOKEN}`,
          },
          body: JSON.stringify({
            app: 'reimbursement',
            title: input.title,
            body: input.body,
            url: input.path ? `${WEB_BASE_URL}${input.path}` : WEB_BASE_URL,
            tag: input.tag,
            audience: input.audience,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          console.error(`[notify] portal returned ${res.status}`);
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      console.error('[notify] failed:', error);
    }
  })();
}
