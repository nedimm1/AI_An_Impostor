import { DarkTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { Colors } from '@/constants/theme';
import { RoomProvider, useRoomStore } from '@/game/store';

// Held over the one disk read that decides whether this is a returning player.
// Without it, somebody who already has a name gets the home screen behaving as
// though they do not, for as long as the read takes.
SplashScreen.preventAutoHideAsync();

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
          <Routes />
        </RoomProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Nothing renders until the stored profile is back, so no screen ever has to
 * guess whether an empty name means "new player" or "not read yet".
 */
function Routes() {
  const { hydrated } = useRoomStore();

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync();
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="name" options={modalOptions} />
      <Stack.Screen name="queue" options={{ gestureEnabled: false }} />
      <Stack.Screen name="how-to-play" options={modalOptions} />
      <Stack.Screen name="settings" options={modalOptions} />
      <Stack.Screen name="room/[id]" />
    </Stack>
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
