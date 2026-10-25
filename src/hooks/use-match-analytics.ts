import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { useEffect, useRef } from 'react';

import { matchEvents } from '@/game/match-events';
import { GAME_URL } from '@/game/remote-transport';
import { useRoom } from '@/game/store';
import type { Room } from '@/game/types';

/**
 * Reports how matches go to Firebase Analytics (see `match-events.ts` for
 * which events). Read off the room rather than sprinkled through the screens,
 * so it sees exactly what the player saw and no screen has to remember to
 * call it.
 */
export function useMatchAnalytics() {
  const room = useRoom();
  const previous = useRef<Room | null>(null);
  const loggedBallots = useRef(new Set<string>());

  useEffect(() => {
    const before = previous.current;
    previous.current = room;

    const analytics = getAnalytics();
    for (const event of matchEvents(before, room, loggedBallots.current, Boolean(GAME_URL))) {
      logEvent(analytics, event.name, event.params);
    }
  }, [room]);
}
