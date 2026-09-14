import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { ROOM_SIZES, type RoomSize } from '@/game/types';

/**
 * How big a room to queue for: three, four or five seats, the impostor's
 * included.
 *
 * Each option says what it plays like, not just a number, because the sizes
 * are different games rather than more or less of the same one. Three is a
 * duel — you know you are human, so the model is one of exactly two other
 * seats. Five is the hunt the rules were tuned for.
 */
const DESCRIPTIONS: Record<RoomSize, string> = {
  3: 'Duel',
  4: 'Quick',
  5: 'Classic',
};

export function RoomSizePicker({
  value,
  onChange,
}: {
  value: RoomSize;
  onChange: (size: RoomSize) => void;
}) {
  return (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel="Room size">
      {ROOM_SIZES.map((size) => {
        const selected = size === value;
        return (
          <Pressable
            key={size}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${size} players, ${DESCRIPTIONS[size]}`}
            onPress={() => onChange(size)}
            style={({ pressed }) => [
              styles.option,
              selected && styles.optionSelected,
              pressed && !selected && styles.optionPressed,
            ]}>
            <ThemedText
              type="subtitle"
              style={[styles.count, selected ? styles.countSelected : styles.countIdle]}>
              {size}
            </ThemedText>
            <ThemedText
              type="label"
              themeColor={selected ? 'text' : 'textMuted'}
              style={styles.caption}>
              {DESCRIPTIONS[size]}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  option: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.half,
    paddingVertical: Spacing.two,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
  },
  optionSelected: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  optionPressed: {
    backgroundColor: Colors.backgroundSelected,
  },
  count: {
    lineHeight: 28,
  },
  countIdle: {
    color: Colors.textSecondary,
  },
  countSelected: {
    color: Colors.accentText,
  },
  caption: {
    fontSize: 10,
    lineHeight: 13,
  },
});
