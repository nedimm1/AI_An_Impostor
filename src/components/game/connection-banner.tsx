import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';

/**
 * Shown while the connection to the game server is down, on every screen.
 *
 * Without it, losing the connection looked like nothing at all: the room stayed
 * on screen, the clock kept counting, and anything you typed went nowhere. Now
 * what you do is held and sent when the connection is back — but you should
 * still know it has not gone yet.
 *
 * It waits a moment before appearing. Most drops are over in under a second,
 * and a banner that flashes on and off for those is noise.
 *
 * It sits in the middle of the screen rather than along an edge, where it was
 * easy to miss under the header. It does not take touches, so the screen
 * behind it still works — anything you do is held until the connection is
 * back.
 *
 * This is your own connection. Other people's drops are shown on their seats
 * instead, as a countdown (`reconnect-timer.tsx`).
 */
const SHOW_AFTER_MS = 1_500;

export function ConnectionBanner() {
  const { connected } = useRoomStore();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (connected) return;
    const timer = setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    // Runs when the connection comes back, which is what hides it again.
    return () => {
      clearTimeout(timer);
      setVisible(false);
    };
  }, [connected]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      accessibilityLiveRegion="polite">
      <View style={styles.pill}>
        <ActivityIndicator size="small" color={Colors.warning} />
        <ThemedText type="smallBold" style={styles.text}>
          Reconnecting…
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Radius.pill,
    backgroundColor: Colors.warningMuted,
    borderWidth: 1,
    borderColor: Colors.warning,
  },
  text: {
    color: Colors.warning,
  },
});
