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
  // One definition, two consumers: a bar's track IS a hairline, so a future
  // tweak to the rules must not silently leave every chart ground behind.
  const hairline = dark ? 'rgba(255,255,255,0.09)' : '#E8E4DF';

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
    hairline,
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
    // Gold-ramp amber, one step deeper than statusPending so a "กำลังโอน" chip
    // never reads as the same wait as "รออนุมัติ" sitting next to it.
    statusPaying: dark ? HF_GOLD[600] : HF_GOLD[700],

    // Data ink. brand-500 measures 1.71:1 against the dark surface, which is
    // why a chart mark is never painted with `accent`: dark mode steps the
    // same hue up to brand-300 instead.
    chartInk: dark ? HF_BRAND[300] : HF_BRAND[500],
    chartInk2: dark ? HF_BRAND[200] : HF_BRAND[400],
    onChartInk: '#fff',
    // brand-200 is a pale rose; white on it measures 2.05:1, so the label flips
    // to the warm near-black instead of following `ink`, which is near-white
    // in dark mode precisely when this fill is at its lightest.
    onChartInk2: dark ? '#26221E' : '#fff',
    // Ordered bands walk the brand ramp rather than fading one fill: at 0.35
    // opacity brand-300 measures 1.59:1 on the dark surface, so the two
    // shortest-wait segments would read as empty tile edge. Dark inverts the
    // direction so the ramp climbs AWAY from the ground in both modes.
    chartSeq: dark
      ? [HF_BRAND[400], HF_BRAND[300], HF_BRAND[200], HF_BRAND[100]]
      : [HF_BRAND[200], HF_BRAND[300], HF_BRAND[400], HF_BRAND[500]],
    chartTrack: hairline,
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
