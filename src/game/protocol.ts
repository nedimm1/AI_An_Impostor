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

import type { Intent, Matchmaking } from './transport';
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
  /** Something my player does in the room. */
  | { type: 'intent'; intent: Intent };

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
  | { type: 'matchmaking'; matchmaking: Matchmaking | null };

/** The path the game socket listens on, beside the impostor's HTTP routes. */
export const GAME_PATH = '/game';
