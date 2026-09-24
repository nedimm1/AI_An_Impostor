import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { ReconnectTimer } from '@/components/game/reconnect-timer';
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
 * ONE LAP AT A TIME. Everybody speaks several times, so the full order is
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
const CURRENT = 36;
const WAITING = 24;

type TurnStripProps = {
  /** Player ids in the order they speak, including repeats. */
  turnOrder: string[];
  /** Index into `turnOrder` of the seat on the clock. */
  turnIndex: number;
  players: Player[];
  /** Seats a tied vote put up. Drawn like everybody else, with "tied" underneath. */
  tied?: string[] | null;
};

/**
 * The order cut into laps: a lap ends where a seat would speak twice.
 *
 * That is the one definition that fits both kinds of order. A round is the
 * same rotation `turnsEach` times over, and cuts into equal laps. A tiebreaker
 * is not quite a rotation - the two it is between get a turn more than
 * everybody else, so its last lap is just them - and cutting by `turnsEach`
 * could not draw it at all. A walkout pulls every one of a player's turns out,
 * which leaves the laps shorter but still whole.
 */
function lapsOf(turnOrder: string[]) {
  const laps: string[][] = [];
  let lap: string[] = [];
  for (const id of turnOrder) {
    if (lap.includes(id)) {
      laps.push(lap);
      lap = [];
    }
    lap.push(id);
  }
  if (lap.length) laps.push(lap);
  return laps;
}

function Seat({
  player,
  state,
  tied,
}: {
  player: Player;
  state: 'spent' | 'now' | 'waiting';
  tied: boolean;
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

  const lit = player.tint || Colors.accent;

  return (
    <View style={styles.slot}>
      {/*
        A box the full size the seat can grow to, with the avatar centred in
        it. Scaling is about the centre, so without this the current seat grows
        down into its own name — which it did, and looked like a layout bug
        rather than emphasis.
      */}
      <Animated.View style={[styles.head, style]}>
        {player.awayUntil ? (
          // Their connection is down: the picture becomes the seconds left.
          <ReconnectTimer until={player.awayUntil} size={WAITING} />
        ) : (
          <Avatar
            id={player.id}
            name={player.name}
            tint={player.tint}
            size={WAITING}
            dimmed={state === 'spent'}
            ringColor={now ? lit : undefined}
          />
        )}
      </Animated.View>

      <ThemedText
        type="label"
        numberOfLines={1}
        style={[
          styles.name,
          player.awayUntil ? styles.nameAway : now ? { color: lit } : styles.nameIdle,
          state === 'spent' && styles.nameSpent,
        ]}>
        {player.awayUntil ? 'reconnecting…' : player.isYou ? 'You' : seatShortName(player.name)}
      </ThemedText>

      {tied ? (
        <View style={styles.tiedTag}>
          <ThemedText type="label" style={styles.tiedText}>
            Tied
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

export function TurnStrip({ turnOrder, turnIndex, players, tied }: TurnStripProps) {
  const all = lapsOf(turnOrder);
  const laps = all.length;

  // Which lap the seat on the clock is in, and where in it. Past the end once
  // the last turn is spoken, so the last lap stays up with everybody spent.
  let lap = 0;
  let here = turnIndex;
  while (lap < laps - 1 && here >= all[lap].length) {
    here -= all[lap].length;
    lap++;
  }
  const seats = all[lap] ?? [];
  // A tiebreaker's last lap is only the two it is between, having the last word.
  const closing = lap > 0 && seats.length > 0 && seats.every((id) => tied?.includes(id));

  return (
    <View style={styles.rail}>
      <View style={styles.lap}>
        {closing ? (
          <ThemedText type="label" style={styles.closing}>
            Closing statements
          </ThemedText>
        ) : null}
        <View style={styles.seats}>
          {seats.map((id, i) => {
            const player = players.find((p) => p.id === id);
            if (!player) return null;

            return (
              <Seat
                key={`${id}-${i}`}
                player={player}
                state={i === here ? 'now' : i < here ? 'spent' : 'waiting'}
                tied={tied?.includes(player.id) ?? false}
              />
            );
          })}
        </View>
      </View>

      {laps > 1 ? (
        /*
         * Which time round the room this is. The header no longer spells it
         * out, so this is the one place it is said: a small "Turn" over the
         * count, and a pip per lap under it with the current one stretched
         * and lit, so a repeated face reads as the second lap at a glance.
         */
        <View
          style={styles.laps}
          accessibilityRole="text"
          accessibilityLabel={`Turn ${lap + 1} of ${laps}`}>
          <ThemedText type="label" style={styles.lapLabel}>
            Turn
          </ThemedText>
          <ThemedText type="smallBold" style={styles.lapCount}>
            {lap + 1}
            <ThemedText type="small" style={styles.lapTotal}>
              /{laps}
            </ThemedText>
          </ThemedText>
          <View style={styles.pips}>
            {Array.from({ length: laps }, (_, i) => (
              <View
                key={i}
                style={[styles.pip, i < lap && styles.pipDone, i === lap && styles.pipNow]}
              />
            ))}
          </View>
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
    paddingVertical: Spacing.one,
  },
  lap: {
    flex: 1,
    gap: Spacing.half,
  },
  closing: {
    textAlign: 'center',
    fontSize: 9,
    lineHeight: 11,
    color: Colors.warning,
  },
  /** One lap, spread across whatever width there is. No scrolling: a lap fits. */
  seats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  slot: {
    alignItems: 'center',
    gap: Spacing.half,
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
  nameAway: {
    color: Colors.warning,
  },
  nameSpent: {
    opacity: 0.5,
  },
  tiedTag: {
    paddingHorizontal: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.warning + '22',
  },
  tiedText: {
    fontSize: 8,
    lineHeight: 11,
    color: Colors.warning,
  },
  /** Which time round the room this is. */
  laps: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minWidth: 48,
    paddingLeft: Spacing.two,
    borderLeftWidth: 1,
    borderLeftColor: Colors.border,
    alignSelf: 'stretch',
  },
  lapLabel: {
    fontSize: 9,
    lineHeight: 11,
    color: Colors.textMuted,
  },
  lapCount: {
    fontSize: 18,
    lineHeight: 22,
    color: Colors.text,
    fontVariant: ['tabular-nums'],
  },
  lapTotal: {
    fontSize: 12,
    color: Colors.textMuted,
  },
  pips: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  pip: {
    width: 5,
    height: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  pipDone: {
    backgroundColor: Colors.textMuted,
  },
  pipNow: {
    width: 12,
    backgroundColor: Colors.accent,
  },
});
