import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type CardProps = {
  children: React.ReactNode;
  /** Optional uppercase label above the card body. */
  title?: string;
  style?: ViewStyle;
  padded?: boolean;
};

export function Card({ children, title, style, padded = true }: CardProps) {
  return (
    <View style={styles.wrapper}>
      {title ? (
        <ThemedText type="label" style={styles.title}>
          {title}
        </ThemedText>
      ) : null}
      <View style={[styles.card, padded && styles.padded, style]}>{children}</View>
    </View>
  );
}

/** Full-bleed horizontal rule matched to the card border. */
export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  title: {
    paddingHorizontal: Spacing.one,
  },
  card: {
    backgroundColor: Colors.backgroundElement,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  padded: {
    padding: Spacing.three,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
  },
});
