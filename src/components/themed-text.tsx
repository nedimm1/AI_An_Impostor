import { StyleSheet, Text, type TextProps } from 'react-native';

import { Fonts, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextType =
  | 'display'
  | 'title'
  | 'subtitle'
  | 'body'
  | 'bodyBold'
  | 'small'
  | 'smallBold'
  | 'label'
  | 'mono';

export type ThemedTextProps = TextProps & {
  type?: ThemedTextType;
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'body', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        styles[type],
        type === 'label' && { color: theme[themeColor ?? 'textSecondary'] },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  display: {
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '800',
    letterSpacing: -1,
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '500',
  },
  bodyBold: {
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '700',
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  mono: {
    fontFamily: Fonts.mono,
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
});
