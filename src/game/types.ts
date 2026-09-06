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
  /**
   * Still in the room. False once they walk out, which is permanent — the
   * matchmaker does not hold a seat and there is no rejoin. They stay listed so
   * the room can see who left rather than just noticing it got smaller.
   *
   * Only a deliberate leave sets this. Putting the phone down is not leaving:
   * you stay in, your turns run out without you, and you are still there when
   * you come back. A dropped connection will have to be told apart from both
   * once there is a connection to drop — until then there is nothing to model,
   * and the local clocks recover from absolute deadlines instead.
   */
  connected: boolean;
  /** Voted out. Still listed, but out of the turn order and the vote. */
  eliminated: boolean;
};

export type Answer = {
  id: string;
  /**
   * What this line of the transcript is. Departures sit in the same list as
   * answers, in order, so the room reads back as it happened — somebody walking
   * out mid-round is part of the case against them.
   */
  kind: 'answer' | 'departure';
  playerId: string;
  /**
   * Which round this was said in. The room only ever shows the round it is on,
   * but the whole match is kept — a report is about something somebody said,
   * and it is no use if the line was thrown away when the round turned over.
   */
  round: number;
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
   * points inside the same round, since that is all the room can see.
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
  /** Seconds each player gets to write their answer. */
  answerSeconds: number;
  /**
   * Seconds the ballot stays open. It closes on its own — a room of strangers
   * cannot wait on somebody who put their phone down, so an undecided vote is
   * cast as it stands when the clock runs out.
   */
  voteSeconds: number;
  /**
   * Seconds the round's result stands before the next round opens on its own.
   * Being voted out is the exception — that screen is a choice, and it waits.
   */
  resultSeconds: number;
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
  /**
   * Your seat in this room, which is your durable player id (see `profile.ts`).
   * Carried on the room rather than assumed as a constant, because the id is
   * the account's, not the seat's, and a server hands it back per match.
   */
  youId: string;
  phase: Phase;
  round: number;
  players: Player[];
  /**
   * Every line of the match so far, oldest first — answers and departures, all
   * rounds. The room is only ever shown the round it is on (`roundAnswers`),
   * but nothing is dropped: this is the record a report is made against.
   */
  transcript: Answer[];
  /** Ids of everyone still in, in the order they answer this round. */
  turnOrder: string[];
  /** Index into `turnOrder`. Equals its length once everyone has answered. */
  turnIndex: number;
  /** Epoch ms the current turn expires, or null between turns. */
  turnEndsAt: number | null;
  /**
   * Epoch ms the vote's current stage ends — the ballot while it is open, then
   * the tally reveal once it has closed. Null outside the vote.
   */
  voteEndsAt: number | null;
  /**
   * Epoch ms the round's result stops standing and the next round opens. Null
   * outside a verdict, and null for a verdict nothing is waiting on — a match
   * that is over does not run down to anything.
   */
  verdictEndsAt: number | null;
  /** The question this round is built around. */
  prompt: string;
  /** This match's prompt order, drawn when the room was seated. */
  prompts: string[];
  /** voterId -> targetId. Empty when the ballot closed with nobody named. */
  votes: Record<string, string>;
  /**
   * Who has locked in, in the order they did. Kept apart from `votes` because
   * abstaining is a way of having voted: you are done, you just named nobody.
   * Nobody sees a tally until everyone here is in, and then only on the result.
   */
  voted: string[];
  /** True once the ballot has closed. From here the room only reads the result. */
  ballotClosed: boolean;
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
  playerCount: 5,
  answerSeconds: 40,
  // Long enough to read the room back, short enough that nobody is waiting on
  // one person to make up their mind.
  voteSeconds: 30,
  resultSeconds: 10,
  // How much of a conversation a round is. One turn each is everybody dropping
  // a line and voting; more than that and the room starts talking back. Also
  // the biggest single dial on what a match costs to run, since the impostor
  // writes one message per turn and each one carries a longer transcript.
  turnsEach: 3,
  // Four humans take three eliminations to whittle down, so a clean match runs
  // three rounds. Four leaves the room one tied round of slack before the
  // impostor has simply outlasted them.
  maxRounds: 4,
  tiebreakerTurns: 3,
  tiebreakerTurnsAccused: 4,
};


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

/** The round the room is currently playing, which is all anybody can read. */
export function roundAnswers(room: Room) {
  return room.transcript.filter((a) => a.round === room.round);
}

export function playerById(room: Room, id: string | null | undefined) {
  if (!id) return undefined;
  return room.players.find((p) => p.id === id);
}

/** The answer a reply points at, if it is still on screen. */
export function answerById(room: Room, id: string | null | undefined) {
  if (!id) return undefined;
  return roundAnswers(room).find((a) => a.id === id && a.kind === 'answer');
}

/** Everyone still in the game — not voted out, and not walked out. */
export function survivors(room: Room) {
  return room.players.filter((p) => !p.eliminated && p.connected);
}

/** True when this player walked out rather than being voted out. */
export function hasLeft(room: Room, id: string | null | undefined) {
  const player = playerById(room, id);
  return player ? !player.connected : false;
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
  return currentTurnId(room) === room.youId;
}

/** True when you are out of the game, whether watching or not. */
export function youAreOut(room: Room) {
  return playerById(room, room.youId)?.eliminated ?? false;
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

/** Everyone whose vote the ballot is still waiting on. */
export function awaitedVoters(room: Room) {
  return survivors(room).filter((p) => !room.voted.includes(p.id));
}

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
  return room.tiebreaker?.includes(room.youId) ?? false;
}
