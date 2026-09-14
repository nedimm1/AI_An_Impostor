/**
 * Who is waiting, who is playing, and in which match.
 *
 * Players choose how big a room they want — three, four or five seats, the
 * impostor's included — and each size has its own queue. A room starts the
 * moment its queue holds enough people for it, and not before.
 *
 * Every seat is a real person except the impostor. There are no stand-ins:
 * they answer with stock lines like "honestly I had to think about this one
 * for way too long", a room spots them in one round, and a game about finding
 * the one seat that is not a person does not survive three that obviously are
 * not.
 *
 * NO STARTING SMALLER. There was briefly a countdown that started a room with
 * fewer people than it wanted when the queue was quiet. A chosen size makes
 * that a broken promise — somebody who asked for five and got four did not get
 * the game they picked — so a queue now waits until it is full.
 *
 * THE COST OF CHOOSING, worth knowing before there are many players: three
 * queues fill more slowly than one would. When few people are online, each is
 * waiting on a share of them.
 */

import { isRoomSize, ROOM_SIZES, type RoomSize } from '../../src/game/types';
import type { Matchmaking } from '../../src/game/transport';

import { Match, type ImpostorModel } from './match';

export type LobbyEvents = {
  /** A match changed; send its people their views. */
  matchChanged: (match: Match) => void;
  /** A queue changed; tell the people in it where they stand. */
  queueChanged: (waiting: string[], progress: Matchmaking) => void;
  /** Somebody stopped being in a queue — matched, or gone. */
  leftQueue: (playerId: string) => void;
  /** A match is gone; whoever was still in it is no longer in a room. */
  matchEnded: (match: Match, playerIds: string[]) => void;
};

export class Lobby {
  /** One queue per room size, in the order people joined it. */
  private readonly queues = new Map<RoomSize, string[]>(ROOM_SIZES.map((size) => [size, []]));
  private readonly byPlayer = new Map<string, Match>();

  constructor(
    private readonly model: ImpostorModel,
    private readonly events: LobbyEvents
  ) {}

  matchFor(playerId: string): Match | null {
    return this.byPlayer.get(playerId) ?? null;
  }

  /** The size of room this player is queueing for, or null if they are not queueing. */
  queuedFor(playerId: string): RoomSize | null {
    for (const [size, waiting] of this.queues) {
      if (waiting.includes(playerId)) return size;
    }
    return null;
  }

  progress(size: RoomSize): Matchmaking {
    // Counted in people, not seats: the impostor's seat is never waited for.
    return { found: this.queue(size).length, total: size - 1 };
  }

  join(playerId: string, size: RoomSize) {
    if (!isRoomSize(size)) return;
    // Already playing — the caller just re-sends the room.
    if (this.byPlayer.has(playerId)) return;

    // Asking for a different size moves you; asking again for the same one is
    // a reconnect, and changes nothing.
    const current = this.queuedFor(playerId);
    if (current === size) {
      this.events.queueChanged([playerId], this.progress(size));
      return;
    }
    if (current !== null) this.remove(playerId, current);

    const waiting = this.queue(size);
    waiting.push(playerId);

    const people = size - 1;
    if (waiting.length >= people) {
      this.start(waiting.splice(0, people));
    }
    this.events.queueChanged(waiting, this.progress(size));
  }

  /** Out of the queue without a match — cancelled, or the connection went. */
  cancel(playerId: string) {
    const size = this.queuedFor(playerId);
    if (size === null) return;
    this.remove(playerId, size);
    this.events.leftQueue(playerId);
    this.events.queueChanged(this.queue(size), this.progress(size));
  }

  /** Walked out of their match. They are free to queue again straight away. */
  leaveMatch(playerId: string) {
    const match = this.byPlayer.get(playerId);
    if (!match) return;
    this.byPlayer.delete(playerId);
    match.leave(playerId);
  }

  private queue(size: RoomSize) {
    return this.queues.get(size)!;
  }

  private remove(playerId: string, size: RoomSize) {
    this.queues.set(
      size,
      this.queue(size).filter((id) => id !== playerId)
    );
  }

  private start(people: string[]) {
    const match = new Match(
      people,
      this.model,
      (m) => this.events.matchChanged(m),
      (m) => {
        const stillIn = [...this.byPlayer].filter(([, x]) => x === m).map(([id]) => id);
        stillIn.forEach((id) => this.byPlayer.delete(id));
        this.events.matchEnded(m, stillIn);
      }
    );

    people.forEach((id) => {
      this.byPlayer.set(id, match);
      this.events.leftQueue(id);
    });
    // The constructor already announced the room, but before anyone was
    // registered against it — say it again now that they are.
    this.events.matchChanged(match);
  }
}
