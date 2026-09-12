import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { seatShortName } from '@/game/seats';
import type { Player } from '@/game/types';
import { formatClock } from '@/hooks/use-countdown';

type VotePanelProps = {
  /** Everyone still in. You are shown but never votable. */
  targets: Player[];
  /** Ids a tiebreaker put up. Marked, not enforced — anyone can still be named. */
  accused: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** True once you have locked in and are only waiting on the room. */
  locked: boolean;
  /** How much of the room has locked in, for the wait. */
  votedCount: number;
  voterCount: number;
  /** False when you are out and only watching the room decide. */
  canVote: boolean;
  title: string;
  note: string;
  /**
   * Seconds left on the vote's current stage — the ballot while it is open,
   * then the reveal. Null when nothing is on the clock.
   */
  remaining: number | null;
  actionLabel: string;
  onAction: () => void;
};

/**
 * The vote, docked under the chatroom rather than on a screen of its own, so
 * the answers you are judging stay on screen while you decide.
 */
export function VotePanel({
  targets,
  accused,
  selected,
  onSelect,
  locked,
  votedCount,
  voterCount,
  canVote,
  title,
  note,
  remaining,
  actionLabel,
  onAction,
}: VotePanelProps) {
  // The last few seconds are when an undecided vote actually costs something.
  const urgent = remaining !== null && remaining <= 10 && !locked;

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <View style={styles.headRow}>
          <ThemedText type="bodyBold" style={styles.title} numberOfLines={1}>
            {title}
          </ThemedText>
          {remaining !== null ? (
            <ThemedText type="mono" themeColor={urgent ? 'danger' : 'textSecondary'}>
              {formatClock(remaining)}
            </ThemedText>
          ) : null}
        </View>
        <ThemedText type="small" themeColor="textMuted" numberOfLines={1}>
          {note}
        </ThemedText>
      </View>

      {/* Wraps rather than scrolls — a candidate you cannot see is one you
          will not consider. */}
      <View style={styles.strip}>
        {targets.map((player) => {
          const isAccused = accused.includes(player.id);
          const isSelected = selected === player.id;
          const disabled = player.isYou || locked || !canVote;

          return (
            <Pressable
              key={player.id}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled }}
              accessibilityLabel={`Vote for ${player.name}`}
              disabled={disabled}
              onPress={() => onSelect(player.id)}
              style={({ pressed }) => [
                styles.chip,
                isSelected && styles.chipSelected,
                pressed && !disabled && styles.chipPressed,
              ]}>
              <Avatar
                id={player.id}
                name={player.name}
                tint={player.tint}
                size={46}
                dimmed={player.isYou}
                ringColor={
                  isSelected ? Colors.accent : isAccused ? Colors.warning : undefined
                }
              />

              <ThemedText
                type="small"
                numberOfLines={1}
                themeColor={player.isYou ? 'textMuted' : 'text'}
                style={styles.name}>
                {player.isYou ? 'You' : seatShortName(player.name)}
              </ThemedText>

              {/* Fixed height so the strip does not jump as the badge changes. */}
              <View style={styles.badge}>
                {isAccused ? <Pill label="Tied" tone="warning" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Once you are in, there is nothing to press — the room has to catch up
          before anybody sees a tally. */}
      {locked ? (
        <ThemedText type="small" themeColor="textMuted" style={styles.waiting}>
          {`${votedCount} of ${voterCount} locked in`}
        </ThemedText>
      ) : (
        <Button label={actionLabel} disabled={canVote && !selected} onPress={onAction} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  head: {
    gap: 2,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  title: {
    flex: 1,
  },
  waiting: {
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
  strip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.one,
  },
  /* Sized so a full room fits on one row — a candidate on a second row reads
     as an afterthought. Wrapping is only the fallback for a narrow screen. */
  chip: {
    width: 52,
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.half,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipSelected: {
    backgroundColor: Colors.accentMuted,
    borderColor: Colors.accent,
  },
  chipPressed: {
    backgroundColor: Colors.backgroundElement,
  },
  name: {
    fontSize: 11,
    lineHeight: 14,
    maxWidth: '100%',
  },
  /* Tall enough for a Pill, fixed so the strip does not jump when one lands. */
  badge: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
