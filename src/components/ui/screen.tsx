import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ScreenProps = {
  children: React.ReactNode;
  /** Which sides get safe-area padding. Chat screens drop 'bottom'. */
  edges?: readonly Edge[];
  /** Set false when the screen manages its own horizontal padding. */
  padded?: boolean;
  style?: ViewStyle;
};

/**
 * Page frame: fills the background, applies safe-area insets and centers
 * content on wide viewports (web / tablets).
 */
export function Screen({
  children,
  edges = ['top', 'bottom', 'left', 'right'],
  padded = true,
  style,
}: ScreenProps) {
  const theme = useTheme();

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <SafeAreaView
        edges={edges}
        style={[styles.safeArea, padded && styles.padded, style]}>
        {children}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  padded: {
    paddingHorizontal: Spacing.four,
  },
});
