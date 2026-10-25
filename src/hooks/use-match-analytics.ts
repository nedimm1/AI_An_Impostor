import { getAnalytics, logEvent } from '@react-native-firebase/analytics';
import { useEffect, useRef } from 'react';

import { GAME_URL } from '@/game/remote-transport';
import { useRoom } from '@/game/store';
import { playerById, type Room } from '@/game/types';

/**
 * Reports how matches go to Firebase Analytics. Read off the room rather than
 * sprinkled through the screens, so it sees exactly what the player saw and no
 * screen has to remember to call it.
 *
 * - `match_started`: you were seated in a room.
 * - `vote_cast`: you locked in a vote, once per ballot (a tiebreaker is its own).
 * - `match_ended`: the match was decided — whether the impostor was caught.
 * - `match_abandoned`: the room went away before it was decided.
 */
export function useMatchAnalytics() {
  const room = useRoom();
  const previous = useRef<Room | null>(null);
  const loggedBallots = useRef(new Set<string>());

  useEffect(() => {
    const before = previous.current;
    previous.current = room;
    const analytics = getAnalytics();

    if (before && before.id !== room?.id && !before.outcome) {
      logEvent(analytics, 'match_abandoned', {
        room_size: before.settings.playerCount,
        round: before.round,
        you_were_out: yesNo(playerById(before, before.youId)?.eliminated),
      });
    }

    if (!room) return;

    if (room.id !== before?.id) {
      loggedBallots.current.clear();
      logEvent(analytics, 'match_started', {
        room_size: room.settings.playerCount,
        online: yesNo(Boolean(GAME_URL)),
      });
    }

    // A tiebreaker is a second ballot in the same round, hence the count.
    const ballot = `${room.round}:${room.ballots.length}`;
    if (room.voted.includes(room.youId) && !loggedBallots.current.has(ballot)) {
      loggedBallots.current.add(ballot);
      logEvent(analytics, 'vote_cast', {
        round: room.round,
        abstained: yesNo(!room.votes[room.youId]),
        tiebreaker: yesNo(room.tiebreaker !== null),
      });
    }

    if (room.outcome && !before?.outcome) {
      logEvent(analytics, 'match_ended', {
        room_size: room.settings.playerCount,
        rounds: room.round,
        impostor_caught: yesNo(room.outcome === 'humans'),
        you_survived: yesNo(!playerById(room, room.youId)?.eliminated),
      });
    }
  }, [room]);
}

/** Analytics params want strings or numbers; these read better in reports. */
function yesNo(value: boolean | undefined) {
  return value ? 'yes' : 'no';
}
