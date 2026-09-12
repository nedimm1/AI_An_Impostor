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
  textOnAccent: '#FFFFFF',

  /** Primary brand / CTA */
  accent: '#7C5CFF',
  accentPressed: '#6A48F5',
  accentMuted: '#1A1533',

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


