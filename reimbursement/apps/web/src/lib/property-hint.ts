// Client-side holder for the estate band's `data-property` hint.
//
// The VALUE is decided on the server, from the Cloudflare Access assertion the
// API has already RS256-verified (`apps/api/src/property_hint.ts`); it rides
// back on the `POST /api/auth/cf-login` response. Nothing here decides
// anything — this module only remembers what the server said, so the one
// `<HfBar />` component can read it without every screen having to pass it
// down.
//
// WHY A MODULE HOLDER RATHER THAN PROPS OR CONTEXT: the bar is rendered from
// five different early-return branches of `App()` and from `DesktopShell`,
// which four screens mount and which receives no identity of its own. Threading
// a prop to all of them would re-create, in prop form, exactly the scattering
// this change exists to remove. This mirrors the auth token next door in
// `api.ts`, which is held the same way for the same reason.
//
// FAIL OPEN: unknown, unset, or unreadable storage means no hint, which leaves
// the attribute off and lists every tool.

/** The two properties the estate band knows about. */
export type PropertyHint = 'hf' | 'hfville';

const PROPERTY_HINT_STORAGE_KEY = 'reimbursement_property_hint';

function isPropertyHint(value: unknown): value is PropertyHint {
  return value === 'hf' || value === 'hfville';
}

function readHintFromStorage(): PropertyHint | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(PROPERTY_HINT_STORAGE_KEY);
    return isPropertyHint(stored) ? stored : null;
  } catch {
    return null;
  }
}

let cachedPropertyHint: PropertyHint | null = readHintFromStorage();

/**
 * Record what the server said about this identity's desk.
 *
 * ALWAYS CALLED WITH THE SERVER'S ANSWER, including `null`. A browser profile
 * outlives a session, and two identities can share one PC (the HF Ville
 * reception desk runs a second Chrome profile for HF's mailbox), so a hint left
 * over from a previous sign-in would scope the wrong desk — worse than never
 * scoping at all. Writing the absent case is what clears it.
 */
export function setPropertyHint(hint: PropertyHint | null | undefined): void {
  cachedPropertyHint = isPropertyHint(hint) ? hint : null;
  if (typeof window === 'undefined') return;
  try {
    if (cachedPropertyHint === null) {
      window.localStorage.removeItem(PROPERTY_HINT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PROPERTY_HINT_STORAGE_KEY, cachedPropertyHint);
    }
  } catch {
    // localStorage may be unavailable (private mode). The in-memory cache still
    // works for this tab, which is all the bar needs.
  }
}

/** The desk this browser was last told it is standing at, if any. */
export function getPropertyHint(): PropertyHint | null {
  return cachedPropertyHint;
}
