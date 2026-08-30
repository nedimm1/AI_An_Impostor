import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  /** Small glyph rendered before the label. */
  icon?: string;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  disabled = false,
  loading = false,
  icon,
  style,
}: ButtonProps) {
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        sizeStyles[size],
        variantStyles[variant],
        pressed && !inactive && pressedStyles[variant],
        inactive && styles.inactive,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={labelColor[variant]} />
      ) : (
        <View style={styles.content}>
          {icon ? (
            <ThemedText
              type={size === 'sm' ? 'smallBold' : 'bodyBold'}
              style={{ color: labelColor[variant] }}>
              {icon}
            </ThemedText>
          ) : null}
          <ThemedText
            type={size === 'sm' ? 'smallBold' : 'bodyBold'}
            style={{ color: labelColor[variant] }}>
            {label}
          </ThemedText>
        </View>
      )}
    </Pressable>
  );
}

const labelColor: Record<ButtonVariant, string> = {
  primary: Colors.textOnAccent,
  secondary: Colors.text,
  ghost: Colors.textSecondary,
  danger: Colors.textOnAccent,
};

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  inactive: {
    opacity: 0.4,
  },
});

const sizeStyles = StyleSheet.create({
  lg: { paddingVertical: 17, paddingHorizontal: Spacing.four },
  md: { paddingVertical: 13, paddingHorizontal: Spacing.three },
  sm: { paddingVertical: 8, paddingHorizontal: Spacing.three, borderRadius: Radius.md },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: Colors.accent },
  secondary: {
    backgroundColor: Colors.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: Colors.danger },
});

const pressedStyles = StyleSheet.create({
  primary: { backgroundColor: Colors.accentPressed },
  secondary: { backgroundColor: Colors.backgroundSelected },
  ghost: { opacity: 0.6 },
  danger: { backgroundColor: Colors.dangerPressed },
});
