import { getPropertyHint } from '../lib/property-hint';

/**
 * THE ONE definition of the HF One estate band's script tag.
 *
 * This tag used to be copy-pasted, byte for byte, at five sites: `DesktopShell`
 * (which four desktop screens mount) and four early-return branches of `App()`
 * — mobile login, mobile admin-employees, mobile admin-settings, and the main
 * mobile shell. Every one of them now renders `<HfBar />`, so the band is
 * described in exactly one place and a sixth branch cannot ship a subtly
 * different copy.
 *
 * `data-portal-only="1"` is preserved from all five originals: monogram +
 * portal link, no switcher, because this app is employee/approver-facing.
 *
 * ── TWO THINGS TO KNOW BEFORE RELYING ON `data-property` HERE ───────────────
 *
 * 1. This element does not currently execute. React 18 creates `<script>` via
 *    `innerHTML` precisely so the "parser-inserted" flag is set and the script
 *    never runs (see react-dom's own comment in `createElement`), and nothing
 *    injects it imperatively, the app is not server-rendered, and `index.html`
 *    carries no copy of it. So `hf-bar.js` is never fetched and the band does
 *    not render — which is also why `body:has(> #hf-bar-host)` never matches
 *    and `--hf-band-offset` always falls back to `0px`.
 * 2. Even once it does run, `data-property` filters the SWITCHER, and
 *    `data-portal-only="1"` means no switcher is built at all (`hf-bar.js`
 *    guards the whole switcher on `if (!portalOnly)`).
 *
 * The attribute is wired anyway so the ONE definition is already correct — it
 * costs nothing, and both of the above are things a later change may undo.
 * Making the band actually appear here is a deliberate, separately reviewed UI
 * change (a 46px band plus the layout shift every fixed screen would take), not
 * a side effect of tidying five copies into one.
 */
export function HfBar() {
  const property = getPropertyHint();
  return (
    <script
      defer
      src="https://erp.thehfhotel.org/shell/hf-bar.js"
      data-app="Reimbursement"
      data-module="finance"
      data-portal-only="1"
      // Spread, not `data-property={property ?? undefined}`, to make the rule
      // explicit: with no hint the attribute is ABSENT, never present-and-empty.
      // The bar defines only two states — a recognized property, or nothing at
      // all, which lists every tool (fail open).
      {...(property ? { 'data-property': property } : {})}
    />
  );
}
