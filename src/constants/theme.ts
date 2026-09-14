/**
 * App-wide design tokens. The app is dark-only by design — there is no light
 * palette and `userInterfaceStyle` is pinned to "dark" in app.json.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  /** Page background, near-black with a cold cast */
  background: '#0A0B0F',
  /** Recessed areas (chat scroll region, inputs) */
  backgroundInset: '#06070A',
  /** Cards, rows, secondary buttons */
  backgroundElement: '#14161D',
  /** Pressed / selected state of an element */
  backgroundSelected: '#1D212B',

  border: '#242835',
  borderStrong: '#39405233',

  text: '#F5F7FA',
  textSecondary: '#98A1B3',
  textMuted: '#5F6879',
  /**
   * What goes on top of a filled accent surface. White, because the accent is
   * a deep red and ink on it measures 3.6:1 against white's 5.4:1.
   *
   * Separate from `textOnDanger` below, which these two shared until the
   * palette changed. One token for "text on a filled colour" only worked while
   * every filled colour happened to want the same answer — and the moment the
   * accent moved off purple it stopped being true, in both directions.
   */
  textOnAccent: '#FFFFFF',
  /**
   * What goes on `danger` and `warning`, which are both light enough that ink
   * wins by a distance: 6.6:1 against white's 3.0:1 on danger, 11.5:1 against
   * 1.7:1 on warning. The danger button was white long before any of this and
   * was under the bar the whole time.
   */
  textOnDanger: '#0A0B0F',

  /**
   * Primary brand / CTA.
   *
   * Red is the most constrained choice this palette can take, because two
   * things are already in the family: `danger` below is a pink-red, and one of
   * the fifteen seat colours is Red. A CTA that reads as either — an error, or
   * a player — is worse than no brand colour at all.
   *
   * So it is measured rather than picked: 27.2 from `danger` and 18.4 from the
   * seat in CIE76. It sits at hue 355 — a true red leaning to crimson — rather
   * than the 3 of a red-orange, which is the difference between this and the
   * brighter shades that came before it.
   *
   * White on it is 5.4:1. Going deeper than this buys a little more of that
   * and costs presence — at #B81D24 the button falls to 3.0:1 against the page
   * and closes to 13.9 of the seat Red, which is nearer than any other pairing
   * in the app.
   */
  accent: '#CF1F2E',
  accentPressed: '#B51828',
  accentMuted: '#2B0F13',
  /**
   * The accent when it has to be text rather than a surface.
   *
   * A deep accent cannot be both. At 3.6:1 against the page, `accent` is fine
   * as a fill with white on it and short of readable as a label on anything
   * dark — the how-to-play step badge was drawing it on `accentMuted` at
   * 3.3:1. No choice of background fixes that, because the accent is only 3.6
   * from black in the first place, so the foreground has to be a lighter
   * sibling. This one is 5.4:1 on the page and 4.9:1 on the muted fill.
   */
  accentText: '#E8505A',

  success: '#3DDC97',
  successMuted: '#0E2A21',

  danger: '#FF5C7A',
  dangerPressed: '#F04467',
  dangerMuted: '#2C1420',

  warning: '#FFB86B',
  warningMuted: '#2B1E10',

  overlay: 'rgba(5, 6, 9, 0.72)',
} as const;

export type ThemeColor = keyof typeof Colors;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

export const MaxContentWidth = 560;

/** Avatar colors, assigned deterministically from a player id. */
export const PlayerColors = [
  '#7C5CFF',
  '#3DDC97',
  '#FF5C7A',
  '#FFB86B',
  '#4CC9F0',
  '#F472B6',
  '#A3E635',
  '#FB7185',
] as const;

export function colorForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PlayerColors[hash % PlayerColors.length];
}


