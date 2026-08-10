import type { Theme } from './types';

/**
 * HF One design tokens.
 *
 * Canonical values live in the ERP repo — `design/HF-ONE.md` and the live
 * stylesheet at https://erp.thehfhotel.org/shell/hf.css. That contract says app
 * repos adopt these values rather than inventing their own, and it names this
 * app directly: remap the old terracotta primary to the `#8B0000` burgundy
 * family, keep the dark scheme, keep the shell band on top.
 *
 * Three rules from the contract shape everything below:
 *   1. Burgundy is the workhorse; gold is jewellery — hairlines, active marks,
 *      one highlight per screen. Never a surface fill.
 *   2. Neutrals are WARM (#26221E / #7A7268 / #E8E4DF). A cool slate grey next
 *      to burgundy reads as a bug.
 *   3. Headings gain weight, not size. The ERP's type ceiling is 18px.
 */

// Sarabun is the HF One face (Thai + Latin superfamily), loaded in index.html.
// The system stack stays behind it so a blocked webfont degrades to something
// with real Thai coverage rather than a fallback with broken tone marks.
const HF_STACK =
  '"Sarabun", "Noto Sans Thai", system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const FONT_DISPLAY = HF_STACK;
export const FONT_UI = HF_STACK;
export const FONT_MONO =
  'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace';

/** Brand ramp, verbatim from hf.css. Exported so screens can reach for a step
 *  the semantic tokens don't cover (tinted chips, hover fills, the band). */
export const HF_BRAND = {
  50: '#FBEAEA',
  100: '#F5C9C9',
  200: '#E9A3A3',
  300: '#C76060',
  400: '#A83030',
  500: '#8B0000',
  600: '#7A0000',
  700: '#6B1212',
  800: '#4F0E0E',
  900: '#3B0A0A',
} as const;

/** Gold ramp. Deliberately sparse in the contract — these six steps are all
 *  that exist. Use sparingly. */
export const HF_GOLD = {
  50: '#FBF6E9',
  100: '#F6EACB',
  300: '#E7C97F',
  500: '#D9A441',
  600: '#B98730',
  700: '#93691F',
} as const;

export function getTheme(dark: boolean, accent: string): Theme {
  return {
    accent,

    // Light surfaces are HF One's warm neutrals: shell / panel / panel-tint.
    // HF One ships no dark palette, but the contract permits this app to keep
    // one provided it is built from brand-800 and warm near-blacks — so the
    // dark ground is a warm brown-black in the #26221E family, never #0E0E10.
    paper: dark ? '#151210' : '#FAF9F7',
    surface: dark ? '#1F1B18' : '#FFFFFF',
    surface2: dark ? '#292420' : '#F4F1ED',

    ink: dark ? '#F6F2ED' : '#26221E',
    inkSoft: dark ? 'rgba(246,242,237,0.64)' : '#7A7268',
    inkSofter: dark ? 'rgba(246,242,237,0.40)' : 'rgba(122,114,104,0.72)',

    // border / border-strong.
    hairline: dark ? 'rgba(255,255,255,0.09)' : '#E8E4DF',
    hairlineStrong: dark ? 'rgba(255,255,255,0.16)' : '#CFC9C1',

    // Semantic set, verbatim from hf.css. brand-500 is too dark to read as text
    // on the dark ground, so dark mode lifts danger to brand-300.
    success: '#2F855A',
    warn: '#B7791F',
    danger: dark ? '#C76060' : '#C53030',

    // Statuses map onto the HF semantic tokens rather than a private palette:
    // pending → warning, approved → info, paid → success, rejected → error.
    // Every status is rendered as a dot plus its Thai label, never colour alone.
    statusPending: dark ? '#D9A441' : '#B7791F',
    statusApproved: dark ? '#7FA8D9' : '#2C5282',
    statusPaid: dark ? '#5FA974' : '#2F855A',
    statusRejected: dark ? '#E08585' : '#C53030',
  };
}

/**
 * Accent choices. The contract pins every internal app to burgundy — the sole
 * sanctioned deviation is the guest-facing Loyalty app — so brand-500 is the
 * default and the alternates stay inside the HF ramps rather than offering
 * off-brand hues.
 */
export const ACCENT_OPTIONS = [
  { label: 'HF Burgundy', value: HF_BRAND[500] },
  { label: 'Burgundy deep', value: HF_BRAND[700] },
  { label: 'Band', value: HF_BRAND[800] },
  { label: 'Gold', value: HF_GOLD[600] },
  { label: 'Ink', value: '#26221E' },
] as const;
