import type { ShareSetup } from '@reimbursement/shared';

/**
 * Everything an iPhone Shortcut needs in order to post a shared receipt —
 * assembled server-side so an employee never has to be handed credentials
 * out of band.
 *
 * WHY THE CLOUDFLARE SECRET IS SERVED TO EMPLOYEES
 *
 * These two values are a Cloudflare Access **service token**: they prove "an HF
 * device", not "this person". On their own they can create nothing — they only
 * get a request past the edge to `/api/inbox/quick`, which then demands that
 * employee's own share token before it will accept a single byte. So the
 * marginal risk of showing them to somebody who has ALREADY cleared Cloudflare
 * Access and holds a valid session is small, and the alternative is worse:
 * shipping the pair by hand to every phone, or — far more dangerous — letting
 * someone publish a pre-filled Shortcut via an iCloud link, which embeds the
 * headers in a URL anyone can fetch.
 *
 * What this deliberately is NOT: a way to hand out the per-employee share
 * token. That one is minted once, shown once, and revocable per device.
 *
 * FAIL-SOFT, NOT FAIL-CLOSED — on purpose. When the env vars are unset the
 * endpoint reports `configured: false` and the UI falls back to "ask your
 * admin for these two values", which is exactly the state of the world before
 * this existed. A dev machine, and any deploy that has not had the secrets
 * added yet, therefore degrades to the old manual path instead of showing an
 * employee a broken screen.
 */

/** The path a Shortcut posts to. Must match `routes/inbox.ts`. */
const UPLOAD_PATH = '/api/inbox/quick';

const DEFAULT_BASE_URL = 'https://reimbursement.thehfhotel.org';

/**
 * Just the env keys this reads — so tests can pass a literal instead of
 * mutating `process.env`.
 *
 * An index signature is included so `process.env` (whose type carries every
 * key) is assignable; without it TypeScript rejects the real call site for
 * having "no properties in common" with a three-key interface.
 */
export interface ShareSetupEnv {
  WEB_BASE_URL?: string | undefined;
  CF_SHARE_CLIENT_ID?: string | undefined;
  CF_SHARE_CLIENT_SECRET?: string | undefined;
  [key: string]: string | undefined;
}

/**
 * Build the setup payload from the environment.
 *
 * Pure: the environment comes in as an argument rather than being read from
 * `process.env` here, so every branch is testable without touching global
 * state or the database.
 */
export function buildShareSetup(env: ShareSetupEnv): ShareSetup {
  const baseUrl = (env.WEB_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const clientId = env.CF_SHARE_CLIENT_ID?.trim() || null;
  const clientSecret = env.CF_SHARE_CLIENT_SECRET?.trim() || null;

  // Both or neither. A half-configured pair cannot authenticate anything, and
  // reporting `configured: true` with a missing secret would send an employee
  // to build a Shortcut that answers 403 with no clue why.
  const configured = clientId !== null && clientSecret !== null;

  return {
    configured,
    uploadUrl: `${baseUrl}${UPLOAD_PATH}`,
    clientId: configured ? clientId : null,
    clientSecret: configured ? clientSecret : null,
  };
}
