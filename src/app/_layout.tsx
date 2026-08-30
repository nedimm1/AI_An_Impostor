import { DarkTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { RoomProvider } from '@/game/store';

/** The app is dark-only; there is no light branch here on purpose. */
const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background,
    card: Colors.backgroundElement,
    text: Colors.text,
    border: Colors.border,
    primary: Colors.accent,
  },
};

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <ThemeProvider value={navigationTheme}>
        <RoomProvider>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: Colors.background },
              animation: 'slide_from_right',
            }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="create" options={modalOptions} />
            <Stack.Screen name="join" options={modalOptions} />
            <Stack.Screen name="how-to-play" options={modalOptions} />
            <Stack.Screen name="settings" options={modalOptions} />
            <Stack.Screen name="room/[code]" />
          </Stack>
        </RoomProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const modalOptions = {
  presentation: 'modal',
  animation: 'slide_from_bottom',
} as const;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
