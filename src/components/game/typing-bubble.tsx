import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { colorForId, Colors, Radius, Spacing } from '@/constants/theme';
import type { Player } from '@/game/types';

/** Same as `AnswerBubble`, so the answer that replaces this lands in its place. */
const AVATAR = 40;

const DOT_MS = 420;

/**
 * The seat on the clock, at the bottom of the chat, as a bubble with dots.
 *
 * The room used to say this in a grey line above the conversation and in the
 * disabled box under it, and neither is where anybody is looking — they are
 * reading the chat. A bubble there makes the room feel occupied while a turn
 * runs, and it is where the answer is about to appear.
 *
 * It says nothing the turn strip does not already: whose turn it is, which is
 * public. It is shown for every seat on the clock alike, the impostor's
 * included, and does not follow keystrokes — a bubble that only moved while a
 * person typed would be a tell.
 */
export function TypingBubble({ player }: { player: Player }) {
  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={`${player.name} is answering`}>
      <Avatar id={player.id} name={player.name} tint={player.tint} size={AVATAR} />
      <View style={styles.column}>
        <ThemedText
          type="smallBold"
          style={[styles.name, { color: player.tint || colorForId(player.id) }]}>
          {player.name}
        </ThemedText>
        <View style={styles.bubble}>
          {[0, 1, 2].map((i) => (
            <Dot key={i} index={i} />
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Each dot lifts and brightens for its third of a cycle, left to right. The
 * cycle is the same length for all three, so the stagger set by the delay holds.
 */
function Dot({ index }: { index: number }) {
  const lift = useSharedValue(0);

  useEffect(() => {
    lift.value = withDelay(
      index * DOT_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DOT_MS / 2, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: DOT_MS / 2, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: DOT_MS * 2 })
        ),
        -1
      )
    );
  }, [index, lift]);

  const style = useAnimatedStyle(() => ({
    opacity: 0.35 + lift.value * 0.65,
    transform: [{ translateY: -lift.value * 3 }],
  }));

  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
    alignItems: 'flex-start',
  },
  column: {
    gap: 3,
    alignItems: 'flex-start',
  },
  /** Matches the name over an `AnswerBubble`. */
  name: {
    fontSize: 13,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 41,
    paddingHorizontal: 14,
    backgroundColor: Colors.backgroundElement,
    borderRadius: 20,
    borderTopLeftRadius: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.textSecondary,
  },
});
