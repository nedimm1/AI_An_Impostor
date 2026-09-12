import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { seatShortName } from '@/game/seats';
import type { Player } from '@/game/types';

/**
 * Whose turn it is, and when yours is coming.
 *
 * It replaces a line of text — "Mr. Teal is answering…" — which said who was
 * speaking and nothing else. The thing that line could not say is the part
 * players actually want: a round is a rotation, so "not yet" and "you are
 * next" are completely different states and the sentence rendered them
 * identically.
 *
 * ONE LAP AT A TIME. Everybody speaks `turnsEach` times, so the full order is
 * fifteen entries and the first version drew all of them, scrolling. That read
 * as one long belt that never ended, and the moment a lap finished was
 * invisible inside it — the strip just kept sliding. It shows a single lap now
 * and starts it again from the left when the room comes round, which is what
 * actually happens, with the lap counted off beside it so a repeated face is
 * obviously the second time rather than a glitch.
 *
 * The seat on the clock grows into place rather than snapping: a jump cut
 * between two sizes reads as a re-render, a spring reads as the wheel landing.
 */
const CURRENT = 46;
const WAITING = 30;

type TurnStripProps = {
  /** Player ids in the order they speak, including repeats. */
  turnOrder: string[];
  /** Index into `turnOrder` of the seat on the clock. */
  turnIndex: number;
  players: Player[];
  /**
   * How many times each seat speaks, which is what makes a lap. Omitted in a
   * tiebreaker, where the order is not a rotation — the accused speak more
   * often than everybody else — so there are no laps to count.
   */
  turnsEach?: number;
  /** Seats a tied vote put up, lit with the warning colour like the vote strip. */
  accused?: string[] | null;
};

function Seat({
  player,
  state,
  accused,
}: {
  player: Player;
  state: 'spent' | 'now' | 'waiting';
  accused: boolean;
}) {
  const now = state === 'now';
  const grow = useSharedValue(now ? 1 : 0);

  useEffect(() => {
    grow.value = now
      ? withSpring(1, { damping: 14, stiffness: 160 })
      : withTiming(0, { duration: 160 });
  }, [now, grow]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + grow.value * (CURRENT / WAITING - 1) }],
  }));

  const lit = accused ? Colors.warning : player.tint || Colors.accent;

  return (
    <View style={styles.slot}>
      {/*
        A box the full size the seat can grow to, with the avatar centred in
        it. Scaling is about the centre, so without this the current seat grows
        down into its own name — which it did, and looked like a layout bug
        rather than emphasis.
      */}
      <Animated.View style={[styles.head, style]}>
        <Avatar
          id={player.id}
          name={player.name}
          tint={player.tint}
          size={WAITING}
          dimmed={state === 'spent'}
          ringColor={now ? lit : undefined}
        />
      </Animated.View>

      <ThemedText
        type="label"
        numberOfLines={1}
        style={[
          styles.name,
          now ? { color: lit } : styles.nameIdle,
          state === 'spent' && styles.nameSpent,
        ]}>
        {player.isYou ? 'You' : seatShortName(player.name)}
      </ThemedText>
    </View>
  );
}

export function TurnStrip({
  turnOrder,
  turnIndex,
  players,
  turnsEach,
  accused,
}: TurnStripProps) {
  /*
   * Seats in one lap. A walkout pulls every one of that player's turns out of
   * the order, so it goes from `alive * turnsEach` to `(alive - 1) * turnsEach`
   * and stays whole laps — but the check is here anyway, because drawing a lap
   * that does not divide would slice the order at the wrong place and the
   * strip would quietly lie about who is next.
   */
  const laps = turnsEach ?? 0;
  const perLap =
    laps > 0 && turnOrder.length % laps === 0 ? turnOrder.length / laps : 0;

  const lap = perLap > 0 ? Math.floor(turnIndex / perLap) : 0;
  const seats = perLap > 0 ? turnOrder.slice(lap * perLap, (lap + 1) * perLap) : turnOrder;
  const here = perLap > 0 ? turnIndex - lap * perLap : turnIndex;

  return (
    <View style={styles.rail}>
      <View style={styles.seats}>
        {seats.map((id, i) => {
          const player = players.find((p) => p.id === id);
          if (!player) return null;

          return (
            <Seat
              key={`${id}-${i}`}
              player={player}
              state={i === here ? 'now' : i < here ? 'spent' : 'waiting'}
              accused={accused?.includes(player.id) ?? false}
            />
          );
        })}
      </View>

      {laps > 1 ? (
        /*
         * Which time round the room this is, as a gauge rather than a caption.
         * The header above already spells it out — "Round 1 · Turn 2 of 3" — so
         * a second set of words would just be the same sentence twice. What
         * the words cannot do at a glance is show the lap filling up, which is
         * the thing that makes a repeated face read as the second lap instead
         * of a bug.
         */
        <View style={styles.laps}>
          <View style={styles.lapBars}>
            {Array.from({ length: laps }, (_, i) => (
              <View
                key={i}
                style={[
                  styles.lapBar,
                  i < lap && styles.lapBarDone,
                  i === lap && styles.lapBarNow,
                ]}
              />
            ))}
          </View>

          <ThemedText type="mono" style={styles.lapCount}>
            <ThemedText type="mono" style={styles.lapCountNow}>
              {lap + 1}
            </ThemedText>
            /{laps}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    backgroundColor: Colors.backgroundInset,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  /** One lap, spread across whatever width there is. No scrolling: a lap fits. */
  seats: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  slot: {
    alignItems: 'center',
    gap: Spacing.one,
    flexShrink: 1,
  },
  head: {
    height: CURRENT,
    justifyContent: 'center',
  },
  name: {
    fontSize: 10,
    lineHeight: 13,
  },
  nameIdle: {
    color: Colors.textMuted,
  },
  nameSpent: {
    opacity: 0.5,
  },
  /** Which time round the room this is. */
  laps: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.one,
    paddingLeft: Spacing.three,
    marginLeft: Spacing.one,
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
    alignSelf: 'stretch',
  },
  lapBars: {
    gap: 3,
  },
  /* Stacked rather than in a row: the column here is narrow, and a lap filling
     downwards reads as progress where three dots read as decoration. */
  lapBar: {
    width: 16,
    height: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  lapBarDone: {
    backgroundColor: Colors.textMuted,
  },
  lapBarNow: {
    backgroundColor: Colors.accent,
  },
  lapCount: {
    fontSize: 10,
    lineHeight: 13,
    color: Colors.textMuted,
  },
  lapCountNow: {
    fontSize: 10,
    lineHeight: 13,
    color: Colors.text,
  },
});
