import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

export type PillTone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';

const tones: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: Colors.backgroundSelected, fg: Colors.textSecondary },
  accent: { bg: Colors.accentMuted, fg: Colors.accent },
  success: { bg: Colors.successMuted, fg: Colors.success },
  danger: { bg: Colors.dangerMuted, fg: Colors.danger },
  warning: { bg: Colors.warningMuted, fg: Colors.warning },
};

export function Pill({
  label,
  tone = 'neutral',
  style,
}: {
  label: string;
  tone?: PillTone;
  style?: ViewStyle;
}) {
  const { bg, fg } = tones[tone];

  return (
    <View style={[styles.pill, { backgroundColor: bg }, style]}>
      <ThemedText type="label" style={{ color: fg }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
});
