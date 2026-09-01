/**
 * Stand-in for the matchmaker. There is no queue server yet, so this reveals a
 * pre-drawn roster of strangers on a timer to give the search screen something
 * honest to count up. The shape — you wait, seats fill, the match starts — is
 * what the real queue will do.
 */

import { useEffect, useRef, useState } from 'react';

import { makeSessionId, mockStrangers } from './mock';
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

type Matchmaking = {
  /** People seated so far, you included. */
  found: number;
  /** Seats the match needs before it starts. */
  total: number;
};

/**
 * Counts strangers into a room of `playerCount` and calls `onMatched` once the
 * last seat fills. The callback fires exactly once per mount.
 */
export function useMatchmaking(
  playerCount: number,
  onMatched: (match: Match) => void
): Matchmaking {
  const [found, setFound] = useState(1);

  // Held in a ref so a new callback identity on re-render doesn't restart the
  // search and re-seat everyone.
  const onMatchedRef = useRef(onMatched);
  onMatchedRef.current = onMatched;

  useEffect(() => {
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
  }, [playerCount]);

  return { found, total: playerCount };
}
