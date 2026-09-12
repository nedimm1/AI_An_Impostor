/**
 * The line between the app and whatever is running the match.
 *
 * Screens on this side of it can do exactly two things: read the room, and say
 * what *you* are doing. They cannot make another player answer, vote or walk
 * out, and they cannot decide that a clock has run out — all of that belongs
 * to whatever is on the other side.
 *
 * Today that is `local-transport.tsx`, which runs the rules on this device and
 * fakes the other six players. Tomorrow it is a socket. The asymmetry is the
 * point: it is the same asymmetry a server introduces, so building against it
 * now means a server does not change a single screen.
 */

import type { Room } from './types';

/**
 * Something you do. Only ever about you — there is no intent for "Mr. Red votes",
 * because that is not yours to say.
 */
export type Intent =
  /** Speak, when the room is on your turn. */
  | { type: 'answer'; text: string; timedOut: boolean; replyToId: string | null }
  /** Lock in a vote, or lock in having named nobody. */
  | { type: 'vote'; targetId: string | null }
  /** Voted out, but staying to watch. */
  | { type: 'spectate' }
  /** Walk out. Final — there is no seat held and no way back in. */
  | { type: 'leave' }
  /**
   * Answer as somebody else. The one intent that breaks the rule above, and
   * it exists only under `TEST_MODE`: with the stand-ins switched off, the
   * six other seats are typed by whoever is holding the phone.
   *
   * It is kept as its own intent rather than folded into `answer` on purpose.
   * A server would reject this outright, and the shape of the thing it would
   * reject should be obvious at the seam rather than hidden inside a flag on
   * a legitimate one.
   */
  | { type: 'answerAs'; playerId: string; text: string; replyToId: string | null };

/** Where you are in the queue, or null when you are not in it. */
export type Matchmaking = {
  /** Players seated so far, you included. */
  found: number;
  /** Seats the match needs before it starts. */
  total: number;
};

export type MatchTransport = {
  /** The room as you are allowed to see it, or null when you are not in one. */
  room: Room | null;
  /** Non-null while the matchmaker is seating you. */
  matchmaking: Matchmaking | null;
  /** Ask to be put in a room. */
  findMatch: () => void;
  /** Do something. Quietly ignored when it is not yours to do. */
  send: (intent: Intent) => void;
};
