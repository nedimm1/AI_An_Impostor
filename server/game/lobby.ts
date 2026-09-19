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
import { Penalties, type Strike } from './penalties';

/**
 * How long somebody can be disconnected during a match before it carries on
 * without them.
 *
 * Losing the connection is not leaving straight away — a phone that drops for a
 * few seconds keeps its seat, and everybody sees its picture become a countdown
 * while it is gone. But somebody who is not coming back holds the room up, so
 * after this long they are out, the same as pressing leave; if it was their
 * turn, what they had typed goes in the room first.
 *
 * Twenty-five seconds is short on purpose: quicker than a turn, so a dead phone
 * costs the room at most one. The trade is that switching to another app for
 * longer than this can also cost you your seat, since a phone in the background
 * usually loses its connection.
 */
export const DISCONNECT_GRACE_MS = Number(process.env.GAME_DISCONNECT_GRACE_MS ?? 25_000);

/** How long a "you were removed" notice is kept for somebody to come back to. */
const REMEMBER_REMOVAL_MS = 30 * 60_000;

export type LobbyEvents = {
  /** A match changed; send its people their views. */
  matchChanged: (match: Match) => void;
  /** A queue changed; tell the people in it where they stand. */
  queueChanged: (waiting: string[], progress: Matchmaking) => void;
  /** Somebody stopped being in a queue — matched, or gone. */
  leftQueue: (playerId: string) => void;
  /** A match is gone; whoever was still in it is no longer in a room. */
  matchEnded: (match: Match, playerIds: string[]) => void;
  /** Left a match that was still going, and what it cost them (`penalties.ts`). */
  struck?: (playerId: string, strike: Strike) => void;
  /** Tried to queue while still waiting out a cooldown. */
  coolingDown?: (playerId: string, cooldownMs: number) => void;
};

export class Lobby {
  /** One queue per room size, in the order people joined it. */
  private readonly queues = new Map<RoomSize, string[]>(ROOM_SIZES.map((size) => [size, []]));
  private readonly byPlayer = new Map<string, Match>();
  /** People in a match whose connection is down, and the timer that removes them. */
  private readonly away = new Map<string, ReturnType<typeof setTimeout>>();
  /** People removed for being away, until they come back and are told. */
  private readonly removed = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly model: ImpostorModel,
    private readonly events: LobbyEvents,
    private readonly graceMs: number = DISCONNECT_GRACE_MS,
    private readonly penalties: Penalties = new Penalties()
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

    // Left a match early and still waiting it out.
    const cooldownMs = this.penalties.cooldownLeft(playerId);
    if (cooldownMs > 0) {
      this.events.coolingDown?.(playerId, cooldownMs);
      return;
    }

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

  /**
   * Walked out of their match. Free to queue again straight away unless the
   * match was still going and this is not their first time (`penalties.ts`).
   */
  leaveMatch(playerId: string) {
    this.back(playerId);
    const match = this.byPlayer.get(playerId);
    if (!match) return;
    const costs = match.leavingCosts(playerId);
    if (match.isOver()) this.penalties.completed(playerId);
    this.byPlayer.delete(playerId);
    match.leave(playerId);
    if (costs) this.events.struck?.(playerId, this.penalties.strike(playerId));
  }

  /**
   * Their connection went. Out of any queue at once — waiting for a match you
   * cannot be told about is waiting for nothing — but a seat in a match is kept
   * for the grace period before the match carries on without them.
   */
  disconnected(playerId: string) {
    this.cancel(playerId);
    const playing = this.byPlayer.get(playerId);
    if (!playing || this.away.has(playerId)) return;

    // A decided match has nothing left to count down for.
    if (!playing.isOver()) playing.setAway(playerId, Date.now() + this.graceMs);

    this.away.set(
      playerId,
      setTimeout(() => {
        this.away.delete(playerId);
        const match = this.byPlayer.get(playerId);
        if (!match) return;
        // A match that is already decided has nothing left to hold up. They are
        // let go of quietly — being told you were removed from a game that had
        // finished would be news about nothing.
        const wasOver = match.isOver();
        const costs = match.leavingCosts(playerId);
        this.byPlayer.delete(playerId);
        match.removeForBeingAway(playerId);
        if (wasOver) {
          this.penalties.completed(playerId);
          return;
        }
        if (costs) this.events.struck?.(playerId, this.penalties.strike(playerId));
        this.removed.set(
          playerId,
          setTimeout(() => this.removed.delete(playerId), REMEMBER_REMOVAL_MS)
        );
      }, this.graceMs)
    );
  }

  /**
   * Their connection is back. Returns true if they were removed while they were
   * gone, so they can be told why they are no longer in the match.
   */
  reconnected(playerId: string): boolean {
    if (this.away.has(playerId)) this.byPlayer.get(playerId)?.setAway(playerId, null);
    this.back(playerId);
    const wasRemoved = this.removed.get(playerId);
    if (!wasRemoved) return false;
    clearTimeout(wasRemoved);
    this.removed.delete(playerId);
    return true;
  }

  private back(playerId: string) {
    const timer = this.away.get(playerId);
    if (timer) clearTimeout(timer);
    this.away.delete(playerId);
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
        stillIn.forEach((id) => {
          this.byPlayer.delete(id);
          this.back(id);
          // Stayed until the reveal: one strike forgiven.
          if (m.isOver()) this.penalties.completed(id);
        });
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
