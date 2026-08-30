/**
 * Shape of a game session. This is deliberately transport-agnostic — right now
 * it lives in local React state (see `store.tsx`), later it gets backed by a
 * realtime server.
 */

export type Phase = 'lobby' | 'chat' | 'voting' | 'results';

export type Player = {
  id: string;
  name: string;
  isHost: boolean;
  /** True for the player using this device. */
  isYou: boolean;
  isReady: boolean;
  connected: boolean;
};

export type MessageKind = 'chat' | 'system';

export type Message = {
  id: string;
  kind: MessageKind;
  /** Empty for system messages. */
  playerId: string;
  text: string;
  createdAt: number;
};

export type Difficulty = 'easy' | 'normal' | 'hard';

export type RoomSettings = {
  maxPlayers: number;
  rounds: number;
  /** Seconds of open chat per round. */
  chatSeconds: number;
  /** Seconds to lock in a vote. */
  voteSeconds: number;
  /** Placeholder for game modes — swapped out when modes land. */
  topic: string;
  difficulty: Difficulty;
};

export type Room = {
  code: string;
  phase: Phase;
  round: number;
  players: Player[];
  messages: Message[];
  /** The question the round is built around. Null in the lobby. */
  prompt: string | null;
  /** voterId -> targetId */
  votes: Record<string, string>;
  settings: RoomSettings;
  /**
   * Who the impostor is. Held back from the UI until `phase === 'results'`.
   * A real build keeps this server-side until the reveal.
   */
  impostorId: string | null;
  /** Epoch ms the current phase auto-advances, or null for untimed phases. */
  phaseEndsAt: number | null;
};

export const DEFAULT_SETTINGS: RoomSettings = {
  maxPlayers: 8,
  rounds: 3,
  chatSeconds: 180,
  voteSeconds: 45,
  topic: 'Mixed',
  difficulty: 'normal',
};

export const YOU_ID = 'you';

export function playerById(room: Room, id: string | null | undefined) {
  if (!id) return undefined;
  return room.players.find((p) => p.id === id);
}

/** targetId -> number of votes cast against them. */
export function voteTally(room: Room) {
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(room.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  return tally;
}

/** The most-voted player, or null on a tie or no votes. */
export function votedOutId(room: Room) {
  const tally = voteTally(room);
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  if (entries.length > 1 && entries[0][1] === entries[1][1]) return null;
  return entries[0][0];
}
