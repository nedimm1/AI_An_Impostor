/**
 * What one person's phone is allowed to know about the room.
 *
 * Everything a phone receives can be read by whoever holds it — not on the
 * screen, but in the raw messages, which anyone curious can print. So the
 * question for every field is not "does a screen show this" but "would this
 * tell a player something the game says they cannot know". Anything that would
 * is removed here, on the server, before it is sent. A screen that happens not
 * to draw a secret is not keeping it.
 *
 * What is held back, and why:
 *
 * - `impostorId`, until the match is decided. It is the answer to the game.
 *   The results screen reveals it once `outcome` is set, and that is also the
 *   moment it arrives.
 * - Other people's votes, while the ballot is open. The room promises nobody
 *   sees the tally until everyone is in; a phone that received every vote as
 *   it landed would be able to read it anyway. Your own vote is kept, because
 *   your screen shows what you locked in. `voted` — who has locked in, not for
 *   whom — stays, because the room does show that.
 * - `prompts`, the match's whole question order. The phone only ever needs the
 *   question on screen (`prompt`), and a player who can see the next five can
 *   get their answers ready while the impostor cannot.
 *
 * What is NOT a leak because of how the match is built, not because of this
 * file: seat ids. People and the impostor are given seat ids from the same
 * generator (`match.ts`), so no seat looks different from another, and nobody's
 * durable player id is ever put in a room.
 */

import type { Room } from '../../src/game/types';

export function viewFor(
  room: Room,
  seatId: string,
  spectating: boolean,
  /** Seat id → when that disconnected person will be removed. See `Player.awayUntil`. */
  awayUntil: ReadonlyMap<string, number> = new Map()
): Room {
  const ballotOpen = room.phase === 'voting' && !room.ballotClosed;

  const votes: Record<string, string> = ballotOpen
    ? room.votes[seatId] !== undefined
      ? { [seatId]: room.votes[seatId] }
      : {}
    : room.votes;

  return {
    ...room,
    youId: seatId,
    players: room.players.map((p) => ({
      ...p,
      isYou: p.id === seatId,
      awayUntil: awayUntil.get(p.id) ?? null,
    })),
    spectating,
    impostorId: room.outcome ? room.impostorId : null,
    votes,
    prompts: [],
  };
}
