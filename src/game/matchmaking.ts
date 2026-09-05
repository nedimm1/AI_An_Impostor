/**
 * Stand-in for the matchmaker. There is no queue server yet, so this reveals a
 * pre-drawn roster of strangers on a timer to give the search screen something
 * honest to count up. The shape — you wait, seats fill, the match starts — is
 * what the real queue will do.
 */

import { useEffect, useRef, useState } from 'react';

import { makeSessionId, mockStrangers } from './mock';
import type { Matchmaking } from './transport';
import type { Player } from './types';

/** Milliseconds before the next stranger is seated. */
const FIRST_SEAT_DELAY = 700;
const MIN_SEAT_DELAY = 500;
const MAX_SEAT_DELAY = 1700;

function nextDelay(isFirst: boolean) {
  if (isFirst) return FIRST_SEAT_DELAY;
  return MIN_SEAT_DELAY + Math.random() * (MAX_SEAT_DELAY - MIN_SEAT_DELAY);
}

export type Match = {
  /** Opaque session id minted by the matchmaker. */
  id: string;
  strangers: Player[];
};

/**
 * Counts strangers into a room of `playerCount` and calls `onMatched` once the
 * last seat fills. Runs only while `searching`, and returns null when it is
 * not — you are either in the queue or you are not.
 */
export function useMatchmaking(
  playerCount: number,
  searching: boolean,
  onMatched: (match: Match) => void
): Matchmaking | null {
  const [found, setFound] = useState(1);

  // Held in a ref so a new callback identity on re-render doesn't restart the
  // search and re-seat everyone.
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  useEffect(() => {
    if (!searching) return;
    const strangers = mockStrangers(playerCount - 1);
    let seated = 0;
    let timer: ReturnType<typeof setTimeout>;

    const seatOne = () => {
      seated += 1;
      setFound(seated + 1);

      if (seated >= strangers.length) {
        onMatchedRef.current({ id: makeSessionId(), strangers });
        return;
      }
      timer = setTimeout(seatOne, nextDelay(false));
    };

    setFound(1);
    timer = setTimeout(seatOne, nextDelay(true));

    return () => clearTimeout(timer);
  }, [playerCount, searching]);

  return searching ? { found, total: playerCount } : null;
}
