import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { formatClock } from '@/hooks/use-countdown';

type RoundBarProps = {
  round: number;
  /**
   * True while the room is talking out a tied vote. The card then drops its
   * label and `prompt` is who it is between - the turn strip counts the turns,
   * the same as in a round.
   */
  tiebreaker?: boolean;
  prompt: string;
  /** Seconds left in the current turn, or null when nobody is on the clock. */
  remaining: number | null;
  /** Seconds a turn gets, used to size the progress track. */
  duration: number;
  /**
   * A line under the prompt for what the room cannot show on its own — that it
   * is your turn, or that you are out. Who else is speaking is not one of
   * those: the turn strip and the typing bubble in the chat already say it.
   */
  status?: string | null;
  /** Drawn at the start of the top row, e.g. the button that leaves the game. */
  leading?: ReactNode;
  /**
   * The turn order strip, when there is one to draw. Passed as a node rather
   * than as data so this file stays a layout and does not have to know what a
   * player is.
   */
  turns?: ReactNode;
};

/** Wide enough for "0:40" in the pill, and the same on the left so the title stays centred. */
const SIDE = 64;

/**
 * Sticky context strip above the answers: which round it is, the prompt
 * everyone is answering, and how long the player on the clock has left.
 *
 * It is the whole top of the chatroom, and kept as short as it will go. A
 * title, a "5 still in" line and a status sentence used to sit above it, and
 * with the keyboard up they left a sliver of the conversation on screen —
 * which is the one thing a player there is trying to read.
 *
 * The question is the card, not a line of bold text among labels: it is what
 * everybody is answering, and the thing a player looks back up for. The turn
 * clock runs along the card's bottom edge, so it reads as the time left on
 * this question rather than a loose bar. Which turn of the lap it is lives in
 * the turn strip's own counter, so the top row only says the round. What only
 * the player needs to know — that it is their turn — sits under the turn strip,
 * next to their own seat in it.
 */
export function RoundBar({
  round,
  tiebreaker,
  prompt,
  remaining,
  duration,
  status,
  leading,
  turns,
}: RoundBarProps) {
  const progress = remaining === null || duration <= 0 ? 0 : remaining / duration;
  const urgent = remaining !== null && remaining <= 10;

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <View style={[styles.side, styles.sideStart]}>{leading}</View>

        {/* Just the round. "1 of 4" read as a count of something on screen, but
            the 4 was the most rounds a match can go before the robot wins by
            lasting — a rule, not progress, and not what anybody looks up for. */}
        <View style={styles.titleBlock}>
          <ThemedText
            type="smallBold"
            style={[styles.roundText, tiebreaker && { color: Colors.warning }]}>
            {tiebreaker ? 'Tiebreaker' : `Round ${round}`}
          </ThemedText>
        </View>

        <View style={[styles.side, styles.sideEnd]}>
          {remaining !== null ? (
            <View
              accessibilityRole="timer"
              accessibilityLabel={`${remaining} seconds left`}
              style={[styles.clock, urgent && styles.clockUrgent]}>
              <ThemedText
                type="mono"
                style={[styles.clockText, urgent && { color: Colors.danger }]}>
                {formatClock(remaining)}
              </ThemedText>
            </View>
          ) : null}
        </View>
      </View>

      <View style={[styles.card, tiebreaker && styles.cardTiebreaker]}>
        {tiebreaker ? null : (
          <ThemedText type="label" style={styles.cardLabel}>
            Conversation starter
          </ThemedText>
        )}
        <ThemedText type="subtitle" style={styles.prompt}>
          {prompt}
        </ThemedText>

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

      {turns}

      {status ? (
        <ThemedText type="smallBold" style={styles.status}>
          {status}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.one,
    paddingBottom: Spacing.two,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  side: {
    width: SIDE,
    flexDirection: 'row',
  },
  sideStart: {
    justifyContent: 'flex-start',
  },
  sideEnd: {
    justifyContent: 'flex-end',
  },
  titleBlock: {
    flex: 1,
    alignItems: 'center',
  },
  roundText: {
    color: Colors.text,
  },
  clock: {
    minWidth: SIDE,
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
  },
  clockUrgent: {
    borderColor: Colors.danger,
    backgroundColor: Colors.dangerMuted,
  },
  clockText: {
    color: Colors.text,
  },
  card: {
    paddingTop: Spacing.two + 2,
    paddingBottom: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
    overflow: 'hidden',
  },
  cardTiebreaker: {
    borderColor: Colors.warning + '55',
  },
  cardLabel: {
    textAlign: 'center',
    color: Colors.accentText,
    marginBottom: Spacing.one,
  },
  prompt: {
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  /** The turn clock, as the card's bottom edge. */
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: Colors.backgroundSelected,
  },
  fill: {
    height: '100%',
  },
  status: {
    textAlign: 'center',
    color: Colors.accentText,
  },
});
