import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { colorForId, initials, Radius } from '@/constants/theme';

type AvatarProps = {
  id: string;
  name: string;
  size?: number;
  /** Colored ring around the avatar, e.g. to mark the current speaker. */
  ringColor?: string;
  dimmed?: boolean;
  style?: ViewStyle;
};

export function Avatar({ id, name, size = 40, ringColor, dimmed, style }: AvatarProps) {
  const color = colorForId(id);

  return (
    <View
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: Radius.pill,
          backgroundColor: color + '2E',
          borderColor: ringColor ?? color + '66',
          borderWidth: ringColor ? 2 : 1,
          opacity: dimmed ? 0.4 : 1,
        },
        style,
      ]}>
      <ThemedText
        type={size >= 40 ? 'smallBold' : 'label'}
        style={{ color, fontSize: Math.max(10, Math.round(size * 0.36)), letterSpacing: 0 }}>
        {initials(name)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
