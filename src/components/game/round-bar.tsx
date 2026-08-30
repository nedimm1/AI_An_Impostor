import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatClock } from '@/hooks/use-countdown';

type RoundBarProps = {
  round: number;
  totalRounds: number;
  prompt: string | null;
  /** Seconds left in the phase, or null when untimed. */
  remaining: number | null;
  /** Total seconds in the phase, used to size the progress track. */
  duration: number;
};

/**
 * Sticky context strip above the chat: which round it is, the prompt everyone
 * is answering, and how long is left.
 */
export function RoundBar({ round, totalRounds, prompt, remaining, duration }: RoundBarProps) {
  const progress = remaining === null || duration <= 0 ? 0 : remaining / duration;
  const urgent = remaining !== null && remaining <= 15;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="label">
          Round {round} / {totalRounds}
        </ThemedText>
        {remaining !== null ? (
          <ThemedText type="mono" themeColor={urgent ? 'danger' : 'textSecondary'}>
            {formatClock(remaining)}
          </ThemedText>
        ) : null}
      </View>

      {prompt ? (
        <ThemedText type="bodyBold" style={styles.prompt}>
          {prompt}
        </ThemedText>
      ) : null}

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              width: `${Math.max(0, Math.min(1, progress)) * 100}%`,
              backgroundColor: urgent ? Colors.danger : Colors.accent,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  prompt: {
    lineHeight: 22,
  },
  track: {
    height: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.backgroundSelected,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
});
