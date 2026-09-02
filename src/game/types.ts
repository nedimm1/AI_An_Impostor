/**
 * Shape of a game session. This is deliberately transport-agnostic — right now
 * it lives in local React state (see `store.tsx`), later it gets backed by a
 * realtime server and a real matchmaker.
 *
 * The match is a loop, not a fixed number of rounds: everyone answers a prompt
 * in turn, everyone votes, one player is removed, and it repeats until one side
 * wins.
 */

export type Phase = 'answering' | 'voting' | 'verdict';

export type Player = {
  id: string;
  name: string;
  /** True for the player using this device. */
  isYou: boolean;
  connected: boolean;
  /** Voted out. Still listed, but out of the turn order and the vote. */
  eliminated: boolean;
};

export type Answer = {
  id: string;
  playerId: string;
  text: string;
  /** True when the clock ran out before they wrote anything. */
  timedOut: boolean;
  /**
   * Written during a tiebreaker rather than in the round proper. The round's
   * own answers stay on screen through a tiebreaker, so the two need telling
   * apart.
   */
  inTiebreaker: boolean;
  /**
   * The answer this one is written at, or null when it stands alone. Only ever
   * points inside the current round — answers are cleared between rounds.
   */
  replyToId: string | null;
  createdAt: number;
};

/** Who won. `humans` = the impostor was voted out; `impostor` = it outlasted them. */
export type Outcome = 'humans' | 'impostor';

/** Decided by the matchmaker, not by a player. Nobody in the room hosts it. */
export type MatchSettings = {
  /** How many people the matchmaker seats, you included. */
  playerCount: number;
  /** Seconds each player gets to write their answer. The only clock in the game. */
  answerSeconds: number;
  /** How many times each player speaks per round, going round the room each time. */
  turnsEach: number;
  /**
   * Rounds the room gets before the impostor has simply outlasted them. Without
   * a cap a room that keeps tying never ends.
   */
  maxRounds: number;
  /** Messages everyone else gets in a tiebreaker. */
  tiebreakerTurns: number;
  /** Messages each accused player gets. More, since it is about them. */
  tiebreakerTurnsAccused: number;
};

export type Room = {
  /**
   * Opaque session id from the matchmaker. Not a code anyone types or shares —
   * you reach a room by being matched into it.
   */
  id: string;
  phase: Phase;
  round: number;
  players: Player[];
  /** Answers to the current round's prompt, in the order they were given. */
  answers: Answer[];
  /** Ids of everyone still in, in the order they answer this round. */
  turnOrder: string[];
  /** Index into `turnOrder`. Equals its length once everyone has answered. */
  turnIndex: number;
  /** Epoch ms the current turn expires, or null between turns. */
  turnEndsAt: number | null;
  /** The question this round is built around. */
  prompt: string;
  /** This match's prompt order, drawn when the room was seated. */
  prompts: string[];
  /** voterId -> targetId */
  votes: Record<string, string>;
  /** Who the round's vote removed, or null when the vote settled on nobody. */
  eliminatedId: string | null;
  /**
   * The players a tied vote put up against each other. The whole room talks it
   * out — them first, and more often than anyone else — then the rest votes
   * between them. Null outside a tiebreaker.
   */
  tiebreaker: string[] | null;
  /** Set once the match is decided; null while it is still running. */
  outcome: Outcome | null;
  /** You were voted out and chose to keep watching rather than leave. */
  spectating: boolean;
  /**
   * Who the impostor is. Held back from the UI until the match is decided.
   * A real build keeps this server-side until the reveal.
   */
  impostorId: string | null;
  settings: MatchSettings;
};

export const DEFAULT_SETTINGS: MatchSettings = {
  playerCount: 7,
  answerSeconds: 45,
  // Dropped from 5 to 1 so a round is quick to play through while testing.
  turnsEach: 1,
  // Six humans take five eliminations to whittle down, so a clean match runs
  // five rounds. Six leaves the room one tied round of slack before the
  // impostor has simply outlasted them.
  maxRounds: 6,
  tiebreakerTurns: 3,
  tiebreakerTurnsAccused: 4,
};

export const YOU_ID = 'you';

/** Small numbers as words, for copy that has to read as a sentence. */
export function countWord(n: number) {
  const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  return words[n] ?? String(n);
}

/** "Mara", "Mara and Deniz", "Mara, Deniz and Ines". */
export function listNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The one prompt nobody draws. Everyone answers it in a tiebreaker, not just
 * the two it is about, so it has to read for the whole room.
 */
export function tiebreakerPrompt(room: Room, accused: string[]) {
  const names = accused.map((id) => playerById(room, id)?.name ?? 'someone');
  return `It is between ${listNames(names)}. Say your piece before the vote.`;
}

export function playerById(room: Room, id: string | null | undefined) {
  if (!id) return undefined;
  return room.players.find((p) => p.id === id);
}

/** The answer a reply points at, if it is still on screen. */
export function answerById(room: Room, id: string | null | undefined) {
  if (!id) return undefined;
  return room.answers.find((a) => a.id === id);
}

/** Everyone still in the game. */
export function survivors(room: Room) {
  return room.players.filter((p) => !p.eliminated);
}

/**
 * Survivors who are not the impostor. The match ends the moment this drops to
 * one: a lone human against the impostor can always be outvoted.
 */
export function humansAlive(room: Room) {
  return survivors(room).filter((p) => p.id !== room.impostorId).length;
}

/** Whose turn it is to answer, or null once the round's answers are all in. */
export function currentTurnId(room: Room) {
  return room.turnOrder[room.turnIndex] ?? null;
}

/**
 * Which time round the room the current turn is, 1-based. Everyone is on the
 * same pass, since turns go round the table rather than stacking per player.
 */
export function currentTurnNumber(room: Room) {
  const seats = survivors(room).length;
  if (seats === 0) return 1;
  return Math.min(room.settings.turnsEach, Math.floor(room.turnIndex / seats) + 1);
}

export function isYourTurn(room: Room) {
  return currentTurnId(room) === YOU_ID;
}

/** True when you are out of the game, whether watching or not. */
export function youAreOut(room: Room) {
  return playerById(room, YOU_ID)?.eliminated ?? false;
}

/** targetId -> number of votes cast against them. */
export function voteTally(room: Room) {
  const tally: Record<string, number> = {};
  for (const targetId of Object.values(room.votes)) {
    tally[targetId] = (tally[targetId] ?? 0) + 1;
  }
  return tally;
}

/**
 * How a vote came out. A tie names everyone level at the top rather than just
 * giving up — those are the players a tiebreaker is between.
 */
export type VoteResult =
  | { kind: 'eliminated'; playerId: string }
  | { kind: 'tied'; playerIds: string[] }
  | { kind: 'nobody' };

export function voteResult(room: Room): VoteResult {
  const entries = Object.entries(voteTally(room));
  if (entries.length === 0) return { kind: 'nobody' };

  const most = Math.max(...entries.map(([, count]) => count));
  const top = entries.filter(([, count]) => count === most).map(([id]) => id);

  if (top.length > 1) return { kind: 'tied', playerIds: top };
  return { kind: 'eliminated', playerId: top[0] };
}

/**
 * True when a tiebreaker put this player up. They are marked in the vote, but
 * the ballot is not narrowed to them — a room that decides both are innocent
 * can still name somebody else, so everyone alive stays votable and everyone
 * alive keeps their vote.
 */
export function isAccused(room: Room, id: string) {
  return room.tiebreaker?.includes(id) ?? false;
}

/** True when the tiebreaker is being held about you. */
export function youAreAccused(room: Room) {
  return room.tiebreaker?.includes(YOU_ID) ?? false;
}
