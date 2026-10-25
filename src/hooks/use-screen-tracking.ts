import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { useSegments } from 'expo-router';
import { useEffect } from 'react';

/**
 * Reports each screen to Firebase Analytics. Uses the route pattern
 * (`room/[id]/round`) rather than the pathname, so every room id doesn't
 * show up as its own screen.
 */
export function useScreenTracking() {
  const segments = useSegments();
  const screen = segments.join('/') || 'index';

  useEffect(() => {
    logEvent(getAnalytics(), 'screen_view', {
      screen_name: screen,
      screen_class: screen,
    });
  }, [screen]);
}
