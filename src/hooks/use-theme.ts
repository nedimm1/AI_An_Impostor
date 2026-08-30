import { Colors } from '@/constants/theme';

/**
 * The app ships dark-only, so this is a constant. It stays a hook so screens
 * don't have to change if a light palette is ever added back.
 */
export function useTheme() {
  return Colors;
}
