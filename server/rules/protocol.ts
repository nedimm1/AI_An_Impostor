/**
 * What goes over the wire between a phone and the game server.
 *
 * Both sides import this file, which is the reason it exists: the phone and the
 * server agreeing on a message is then something the compiler checks rather
 * than something two files have to be kept in step on by hand.
 *
 * Every message is one JSON object with a `type`. There are very few of them on
 * purpose. The phone never sends a room and the server never sends an order —
 * the phone says what its player is doing (an `Intent`, the same one the local
 * transport takes), and the server sends back the room as that player is
 * allowed to see it. Everything else the game does happens inside the server.
 */

import type { Intent, Matchmaking, Notice } from './transport';
import type { Room, RoomSize } from './types';

/** Phone → server. */
export type ClientMessage =
  /**
   * First thing on every connection. The id is the durable one from
   * `profile.ts`, so a phone that drops and reconnects is recognised as the
   * same player rather than a new one.
   */
  | { type: 'hello'; playerId: string }
  /** Put me in the queue for a room of this many seats. */
  | { type: 'findMatch'; seats: RoomSize }
  /**
   * Something my player does in the room.
   *
   * `at` is the moment in the match the phone was looking at when it sent this
   * (`momentOf`). A phone that lost its connection holds what you did and sends
   * it once it is back — and by then the turn it was typed for may be over, or,
   * worse, it may be your turn again on the next lap. The server compares `at`
   * with where the match actually is and drops anything that arrives for a
   * moment that has passed, so an answer never lands on a turn it was not
   * written for.
   */
  | { type: 'intent'; intent: Intent; at: string }
  /**
   * What you have typed so far on your turn, sent as you type.
   *
   * Only so the server has your words if your connection drops mid-turn: when
   * the turn ends, or you are removed for being away, what you had typed is
   * put in the room for you. It is kept on the server and never shown to
   * anybody before then. Ignored when it is not your turn, or `at` is not the
   * moment the match is in.
   */
  | { type: 'draft'; text: string; at: string }
  /** Reply to the server's `ping`. */
  | { type: 'pong' };

/** Server → phone. */
export type ServerMessage =
  /**
   * The room, as this player sees it — or null when they are not in one.
   *
   * `serverNow` is the server's clock at the moment it was sent. Every deadline
   * in the room (`turnEndsAt` and the rest) is on that clock, and a phone's
   * clock can be seconds away from it, so the phone uses this to move the
   * deadlines onto its own clock before anything counts down against them.
   */
  | { type: 'room'; room: Room | null; serverNow: number }
  /** Queue progress, or null once the player has left the queue. */
  | { type: 'matchmaking'; matchmaking: Matchmaking | null }
  /**
   * Are you still there. Sent every so often; the phone answers `pong`.
   *
   * A connection that dies in a tunnel often does not close — it just goes
   * quiet, and neither end notices for minutes. The heartbeat is how both
   * notice: the server drops a phone that stops answering, and the phone
   * reconnects when it stops hearing anything.
   *
   * It carries the server's clock too, so an idle phone keeps getting fresh
   * readings of how far its own clock is from the server's (`clock.ts`).
   */
  | { type: 'ping'; serverNow: number }
  /**
   * Something that happened while you could not be told. Sent on reconnect.
   *
   * `removedForBeingAway`: you were disconnected for too long and the match
   * carried on without you — see `DISCONNECT_GRACE_MS` on the server.
   */
  | { type: 'notice'; notice: Notice };


/**
 * How often the server checks in.
 *
 * Tied to how quickly a silent drop has to be noticed. A player is removed 25
 * seconds after the server knows they are gone (`DISCONNECT_GRACE_MS`), and
 * a connection that dies without closing is only known to be gone after
 * `SILENCE_LIMIT_MS` of quiet — so that has to be short too, or the countdown
 * other players see would start long after the phone actually vanished.
 */
export const HEARTBEAT_MS = 5_000;

/**
 * How long either side waits without hearing anything before treating the
 * connection as dead. Three heartbeats, so one slow reply is not a disconnect.
 */
export const SILENCE_LIMIT_MS = HEARTBEAT_MS * 3;

/**
 * Where a match is, as a short string both sides can compute from a room: which
 * match, round, tiebreaker or not, phase, and — while answering — whose turn.
 * Two rooms at the same moment give the same string. See `ClientMessage.intent`.
 */
export function momentOf(room: Pick<Room, 'id' | 'round' | 'tiebreaker' | 'phase' | 'turnIndex'>) {
  return [
    room.id,
    room.round,
    room.tiebreaker ? 'tb' : 'r',
    room.phase,
    room.phase === 'answering' ? room.turnIndex : '',
  ].join(':');
}

/** The path the game socket listens on, beside the impostor's HTTP routes. */
export const GAME_PATH = '/game';
