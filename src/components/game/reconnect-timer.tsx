import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius } from '@/constants/theme';
import { useCountdown } from '@/hooks/use-countdown';

/**
 * A seat whose connection is down, drawn in place of its picture: the seconds
 * left before the match carries on without them.
 *
 * Same size and shape as an `Avatar`, so swapping one for the other does not
 * move anything around it. Reaches zero on the server's schedule, not its own —
 * `until` is the server's removal time already moved onto this phone's clock.
 */
export function ReconnectTimer({ until, size }: { until: number; size: number }) {
  const seconds = useCountdown(until) ?? 0;

  return (
    <View
      accessibilityRole="timer"
      accessibilityLabel={`Reconnecting, ${seconds} seconds left`}
      style={[
        styles.ring,
        { width: size, height: size, borderWidth: Math.max(2, Math.round(size * 0.06)) },
      ]}>
      <ThemedText
        type="smallBold"
        style={[styles.seconds, { fontSize: Math.max(11, Math.round(size * 0.38)) }]}>
        {seconds}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderColor: Colors.warning,
    backgroundColor: Colors.warningMuted,
  },
  seconds: {
    color: Colors.warning,
    fontVariant: ['tabular-nums'],
  },
});
