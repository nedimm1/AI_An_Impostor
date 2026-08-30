import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Colors, Radius, Spacing } from '@/constants/theme';
import type { Player } from '@/game/types';

type VoteRowProps = {
  player: Player;
  selected: boolean;
  /** Votes cast against this player. Hidden while votes are still secret. */
  voteCount?: number;
  /** Blocks the press without greying the row — the tally stays readable. */
  disabled?: boolean;
  /** Greys the row out. Only for players who were never a valid target. */
  dimmed?: boolean;
  onPress: () => void;
};

export function VoteRow({ player, selected, voteCount, disabled, dimmed, onPress }: VoteRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={`Vote for ${player.name}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && !disabled && styles.pressed,
        dimmed && styles.dimmed,
      ]}>
      <Avatar
        id={player.id}
        name={player.name}
        size={44}
        ringColor={selected ? Colors.accent : undefined}
      />

      <View style={styles.names}>
        <ThemedText type="bodyBold" numberOfLines={1}>
          {player.name}
        </ThemedText>
        {player.isYou ? (
          <ThemedText type="small" themeColor="textMuted">
            You can&apos;t vote for yourself
          </ThemedText>
        ) : null}
      </View>

      {voteCount !== undefined && voteCount > 0 ? (
        <Pill label={`${voteCount} vote${voteCount === 1 ? '' : 's'}`} tone="warning" />
      ) : null}

      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
  },
  rowSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  pressed: {
    opacity: 0.7,
  },
  dimmed: {
    opacity: 0.4,
  },
  names: {
    flex: 1,
    gap: 2,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: Colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
  },
});
