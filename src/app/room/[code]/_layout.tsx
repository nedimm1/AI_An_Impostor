import { Stack } from 'expo-router';

import { Colors } from '@/constants/theme';

export default function RoomLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.background },
        animation: 'slide_from_right',
      }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="chat" options={{ gestureEnabled: false }} />
      <Stack.Screen
        name="vote"
        options={{ animation: 'slide_from_bottom', gestureEnabled: false }}
      />
      <Stack.Screen name="results" options={{ animation: 'fade', gestureEnabled: false }} />
    </Stack>
  );
}
