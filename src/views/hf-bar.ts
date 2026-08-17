// Payroll — THE ONE definition of the HF One estate band's script tag.
//
// This tag used to be copy-pasted, byte for byte, at the end of all five
// payroll pages (main, approvals, status, accounts, worksheet). Every page now
// carries the `<!--HF_BAR-->` placeholder instead and `renderHTML` substitutes
// what this module builds, so the band is described in exactly one place and a
// sixth page cannot ship a subtly different copy.
//
// It is substituted PER REQUEST rather than interpolated at import time (the
// `ZOOM_HTML` pattern) because it now depends on the caller: see
// `data-property` below. That makes it the same shape as `<!--ADMIN_NAV-->`
// and `<!--ADMIN_MODAL-->`.

import type { PropertyHint } from "../property-hint";

/** The placeholder each view carries where the band's script tag goes. */
export const HF_BAR_PLACEHOLDER = "<!--HF_BAR-->";

/**
 * The estate band's script tag, optionally scoped to the property the caller is
 * standing at.
 *
 * `data-property` is OMITTED ENTIRELY when there is no hint — never emitted
 * empty. The bar treats an absent attribute as "this app cannot tell where its
 * user is" and lists every tool, which is the correct, fail-open default for
 * managers, phones and everyone the app cannot place; an empty value would be a
 * third state nobody has defined.
 *
 * The value needs no escaping: `PropertyHint` is a two-literal union produced
 * only by `property-hint.ts`'s own guard, so nothing caller-controlled reaches
 * the attribute.
 */
export function hfBarScriptTag(hint: PropertyHint | undefined): string {
  const property = hint ? ` data-property="${hint}"` : "";
  return `<script defer src="https://erp.thehfhotel.org/shell/hf-bar.js" data-app="Payroll" data-module="finance"${property}></script>`;
}
