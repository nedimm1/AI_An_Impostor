import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatClock } from '@/hooks/use-countdown';

type RoundBarProps = {
  round: number;
  /** Which time round the room this is, 1-based. */
  turn: number;
  /** How many times each player speaks per round. */
  turnsEach: number;
  prompt: string;
  /** Seconds left in the current turn, or null when nobody is on the clock. */
  remaining: number | null;
  /** Seconds a turn gets, used to size the progress track. */
  duration: number;
  /** Right-hand caption, e.g. whose turn it is. */
  status?: string;
};

/**
 * Sticky context strip above the answers: which round it is, the prompt
 * everyone is answering, and how long the player on the clock has left.
 */
export function RoundBar({ round, turn, turnsEach, prompt, remaining, duration, status }: RoundBarProps) {
  const progress = remaining === null || duration <= 0 ? 0 : remaining / duration;
  const urgent = remaining !== null && remaining <= 15;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="label">
          Round {round} · Turn {turn} of {turnsEach}
        </ThemedText>
        {remaining !== null ? (
          <ThemedText type="mono" themeColor={urgent ? 'danger' : 'textSecondary'}>
            {formatClock(remaining)}
          </ThemedText>
        ) : null}
      </View>

      <ThemedText type="bodyBold" style={styles.prompt}>
        {prompt}
      </ThemedText>

      {status ? (
        <ThemedText type="small" themeColor="textSecondary">
          {status}
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
