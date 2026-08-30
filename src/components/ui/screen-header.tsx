import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type ScreenHeaderProps = {
  title?: string;
  subtitle?: string;
  /** Hidden when there is nothing to go back to. */
  onBack?: () => void;
  /** Rendered on the trailing edge — usually a Pill or icon button. */
  right?: React.ReactNode;
};

/**
 * Custom header. The native stack header is disabled app-wide so screens can
 * put game state (room code, round, timer) in the same row.
 */
export function ScreenHeader({ title, subtitle, onBack, right }: ScreenHeaderProps) {
  const router = useRouter();
  const handleBack = onBack ?? (router.canGoBack() ? router.back : undefined);

  return (
    <View style={styles.row}>
      {handleBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={handleBack}
          hitSlop={12}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <ThemedText type="subtitle" style={styles.backGlyph}>
            ‹
          </ThemedText>
        </Pressable>
      ) : null}

      <View style={styles.titleBlock}>
        {title ? <ThemedText type="subtitle">{title}</ThemedText> : null}
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>

      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backGlyph: {
    lineHeight: 28,
    marginTop: -4,
  },
  pressed: {
    opacity: 0.6,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
});
