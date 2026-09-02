import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Player } from '@/game/types';

type VotePanelProps = {
  /** Everyone still in. You are shown but never votable. */
  targets: Player[];
  /** Ids a tiebreaker put up. Marked, not enforced — anyone can still be named. */
  accused: string[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** True once the room has voted, which is when the tally becomes readable. */
  votesIn: boolean;
  tally: Record<string, number>;
  /** False when you are out and only watching the room decide. */
  canVote: boolean;
  title: string;
  note: string;
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
  votesIn,
  tally,
  canVote,
  title,
  note,
  actionLabel,
  onAction,
}: VotePanelProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <ThemedText type="bodyBold">{title}</ThemedText>
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
          const count = tally[player.id] ?? 0;
          const disabled = player.isYou || votesIn || !canVote;

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
                size={34}
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
                {player.isYou ? 'You' : player.name}
              </ThemedText>

              {/* Fixed height so the strip does not jump when the tally lands. */}
              <View style={styles.badge}>
                {votesIn ? (
                  count > 0 ? (
                    <Pill label={`${count}`} tone="warning" />
                  ) : null
                ) : isAccused ? (
                  <Pill label="Tied" tone="warning" />
                ) : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Button label={actionLabel} disabled={!votesIn && canVote && !selected} onPress={onAction} />
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
