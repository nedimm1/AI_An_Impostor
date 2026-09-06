/**
 * The game itself: a pure reducer over a room, and nothing else.
 *
 * Deliberately free of React, storage and the network. Every rule that decides
 * what a room does — whose turn it is, what a tied vote means, what happens
 * when somebody walks out mid-ballot, who has won — lives here and can be
 * played out in a test without a device. `store.tsx` is the React binding
 * around it, and a server, when there is one, replaces that binding rather
 * than this file.
 */

import { makeId, shuffledPrompts } from './mock';
import { IMPOSTOR_NAME, TEST_MODE } from './testing';
import {
  awaitedVoters,
  currentTurnId,
  DEFAULT_SETTINGS,
  humansAlive,
  roundAnswers,
  survivors,
  tiebreakerPrompt,
  voteResult,
  type Outcome,
  type Player,
  type Room,
} from './types';

/**
 * Everything that can happen to a room. These are not player intents: most of
 * them name whoever it was, because a room is moved by seven people and not
 * just by you. Turning "what you did" into one of these is the transport's
 * job — see `transport.ts`.
 */
export type MatchAction =
  | { type: 'startMatch'; id: string; yourId: string; yourName: string; strangers: Player[] }
  | { type: 'answerTurn'; text: string; timedOut: boolean; replyToId: string | null }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'castVote'; voterId: string; targetId: string | null }
  | { type: 'closeBallot' }
  | { type: 'nextRound' }
  | { type: 'spectate' }
  | { type: 'leaveRoom' }
  | { type: 'rename'; name: string };

function secondsFromNow(seconds: number) {
  return Date.now() + seconds * 1000;
}

function pickPrompt(prompts: string[], round: number) {
  return prompts[(round - 1) % prompts.length];
}

/**
 * Who answers, in what order, this round. Rotated by round so the same player
 * isn't always stuck going first with nothing to react to, then repeated once
 * per pass so everyone gets several goes at the same prompt.
 */
function turnOrderFor(players: Player[], round: number, turnsEach: number) {
  const alive = players.filter((p) => !p.eliminated && p.connected).map((p) => p.id);
  if (alive.length === 0) return [];
  const start = (round - 1) % alive.length;
  const rotated = [...alive.slice(start), ...alive.slice(0, start)];
  return Array.from({ length: turnsEach }, () => rotated).flat();
}

/**
 * Seats you among the strangers the matchmaker found and opens round one. The
 * impostor is drawn here purely so the shell can reveal *someone* at the end —
 * real selection happens server-side and never reaches the client early.
 */
function matchedRoom(id: string, yourId: string, name: string, strangers: Player[]): Room {
  const you: Player = {
    id: yourId,
    name: name || 'You',
    isYou: true,
    connected: true,
    eliminated: false,
  };

  // Your seat is random so you aren't always the first name in the room.
  const players = [...strangers];
  players.splice(Math.floor(Math.random() * (players.length + 1)), 0, you);

  const impostor = strangers[Math.floor(Math.random() * strangers.length)];
  // Testing only, and a rename rather than a reveal: the room, the model and
  // the transcript all have to agree on what it is called, or it cannot pick
  // its own lines out of the room it is reading. See `testing.ts`.
  if (TEST_MODE && impostor) impostor.name = IMPOSTOR_NAME;

  const prompts = shuffledPrompts();

  return {
    id,
    youId: yourId,
    phase: 'answering',
    round: 1,
    players,
    transcript: [],
    turnOrder: turnOrderFor(players, 1, DEFAULT_SETTINGS.turnsEach),
    turnIndex: 0,
    turnEndsAt: secondsFromNow(DEFAULT_SETTINGS.answerSeconds),
    voteEndsAt: null,
    verdictEndsAt: null,
    prompt: pickPrompt(prompts, 1),
    prompts,
    votes: {},
    voted: [],
    ballotClosed: false,
    eliminatedId: null,
    tiebreaker: null,
    outcome: null,
    spectating: false,
    impostorId: impostor?.id ?? null,
    settings: { ...DEFAULT_SETTINGS, playerCount: players.length },
  };
}

/**
 * Who speaks in a tiebreaker and in what order. The accused open every pass —
 * it is their case to make — and the room answers back. They get more messages
 * than everyone else, and the spare ones land at the end, so they also have the
 * last word before the vote.
 */
function tiebreakerTurnOrder(room: Room, accused: string[]) {
  const alive = room.players.filter((p) => !p.eliminated && p.connected).map((p) => p.id);
  const first = alive.filter((id) => accused.includes(id));
  const rest = alive.filter((id) => !accused.includes(id));
  const { tiebreakerTurns, tiebreakerTurnsAccused } = room.settings;

  const order: string[] = [];
  for (let pass = 0; pass < Math.max(tiebreakerTurns, tiebreakerTurnsAccused); pass++) {
    if (pass < tiebreakerTurnsAccused) order.push(...first);
    if (pass < tiebreakerTurns) order.push(...rest);
  }
  return order;
}

/**
 * Puts the tied players up against each other and reopens the room to talk it
 * out, then a second vote between just those two. The round's answers stay on
 * screen — the case is made against what was already said, not in isolation.
 */
function startTiebreaker(room: Room, tied: string[]): Room {
  return {
    ...room,
    phase: 'answering',
    tiebreaker: tied,
    prompt: tiebreakerPrompt(room, tied),
    votes: {},
    voted: [],
    ballotClosed: false,
    eliminatedId: null,
    turnOrder: tiebreakerTurnOrder(room, tied),
    turnIndex: 0,
    turnEndsAt: secondsFromNow(room.settings.answerSeconds),
    voteEndsAt: null,
    verdictEndsAt: null,
  };
}

/**
 * Takes a player out of the remaining turns. Their turns simply disappear —
 * nobody sits through forty-five seconds of silence for someone who is not
 * there — and the index shifts back by however many of theirs had already gone
 * so the room keeps its place in the order.
 */
function turnOrderWithout(room: Room, playerId: string) {
  const goneBefore = room.turnOrder
    .slice(0, room.turnIndex)
    .filter((id) => id === playerId).length;

  return {
    turnOrder: room.turnOrder.filter((id) => id !== playerId),
    turnIndex: room.turnIndex - goneBefore,
  };
}

/**
 * Decides the match after a vote resolves. Catching the impostor ends it
 * immediately; otherwise the impostor wins the moment it is down to one human,
 * because a lone human can always be outvoted.
 */
function outcomeFor(room: Room, eliminatedId: string | null): Outcome | null {
  if (eliminatedId && eliminatedId === room.impostorId) return 'humans';
  // A human who walks out is a human the impostor no longer has to fool, so
  // this catches a room that empties out as well as one that is whittled down.
  if (humansAlive(room) <= 1) return 'impostor';
  // Rounds the room failed to use are rounds the impostor survived.
  if (room.round >= room.settings.maxRounds) return 'impostor';
  return null;
}

/**
 * Closes the ballot and works out what the room decided. A first tie reopens
 * the room to talk it out instead; a tie inside a tiebreaker removes nobody and
 * the round is simply spent.
 */
function resolveBallot(room: Room): Room {
  const result = voteResult(room);
  if (result.kind === 'tied' && !room.tiebreaker) {
    return startTiebreaker(room, result.playerIds);
  }

  const eliminatedId = result.kind === 'eliminated' ? result.playerId : null;

  const resolved: Room = {
    ...room,
    players: eliminatedId
      ? room.players.map((p) => (p.id === eliminatedId ? { ...p, eliminated: true } : p))
      : room.players,
    eliminatedId,
    phase: 'verdict',
    turnEndsAt: null,
    voteEndsAt: null,
    ballotClosed: true,
  };

  const outcome = outcomeFor(resolved, eliminatedId);
  return {
    ...resolved,
    outcome,
    // A decided match has nowhere to go, so nothing is counting down on it.
    verdictEndsAt: outcome ? null : secondsFromNow(resolved.settings.resultSeconds),
  };
}

/**
 * The room, and only the room. Null means you are not in one: the home screen,
 * the queue, or a match you have walked out of.
 */
export function roomReducer(room: Room | null, action: MatchAction): Room | null {
  switch (action.type) {
    case 'startMatch':
      return matchedRoom(action.id, action.yourId, action.yourName, action.strangers);

    case 'leaveRoom':
      return null;

    case 'rename':
      if (!room) return room;
      return {
        ...room,
        players: room.players.map((p) => (p.isYou ? { ...p, name: action.name } : p)),
      };

    case 'answerTurn': {
      if (!room || room.phase !== 'answering') return room;
      const speakerId = currentTurnId(room);
      if (!speakerId) return room;

      // A reply only holds if its target is still on screen — the transcript
      // keeps every round, but the room is only shown the one it is on.
      const replyToId =
        !action.timedOut && roundAnswers(room).some((a) => a.id === action.replyToId)
          ? action.replyToId
          : null;

      const transcript = [
        ...room.transcript,
        {
          id: makeId('ans'),
          kind: 'answer' as const,
          playerId: speakerId,
          round: room.round,
          text: action.text.trim(),
          timedOut: action.timedOut,
          inTiebreaker: room.tiebreaker !== null,
          replyToId,
          createdAt: Date.now(),
        },
      ];

      const turnIndex = room.turnIndex + 1;
      const everyoneAnswered = turnIndex >= room.turnOrder.length;

      return {
        ...room,
        transcript,
        turnIndex,
        phase: everyoneAnswered ? 'voting' : 'answering',
        turnEndsAt: everyoneAnswered ? null : secondsFromNow(room.settings.answerSeconds),
        voteEndsAt: everyoneAnswered ? secondsFromNow(room.settings.voteSeconds) : null,
      };
    }

    case 'playerLeft': {
      if (!room || room.outcome) return room;
      const player = room.players.find((p) => p.id === action.playerId);
      if (!player || !player.connected || player.eliminated) return room;

      const wasSpeaking = currentTurnId(room) === action.playerId;
      const { turnOrder, turnIndex } = turnOrderWithout(room, action.playerId);
      const everyoneAnswered = turnIndex >= turnOrder.length;

      // Whatever they had voted for goes with them.
      const votes = { ...room.votes };
      delete votes[action.playerId];
      const voted = room.voted.filter((id) => id !== action.playerId);

      // Walking out of your own tiebreaker takes you out of it. The one still
      // standing is not handed the elimination — that would be a way to remove
      // anybody by quitting — so the room simply votes with the accusation
      // collapsed.
      const stillAccused = room.tiebreaker?.filter((id) => id !== action.playerId) ?? null;
      const accusationHeld = stillAccused === null || stillAccused.length >= 2;

      const left: Room = {
        ...room,
        players: room.players.map((p) =>
          p.id === action.playerId ? { ...p, connected: false } : p
        ),
        tiebreaker: stillAccused,
        prompt:
          stillAccused === null
            ? room.prompt
            : accusationHeld
              ? tiebreakerPrompt(room, stillAccused)
              : `${player.name} walked out mid-accusation. The room still has to vote.`,
        transcript: [
          ...room.transcript,
          {
            id: makeId('out'),
            kind: 'departure' as const,
            playerId: action.playerId,
            round: room.round,
            text: '',
            timedOut: false,
            inTiebreaker: room.tiebreaker !== null,
            replyToId: null,
            createdAt: Date.now(),
          },
        ],
        votes,
        voted,
        turnOrder,
        turnIndex,
        phase: room.phase === 'answering' && everyoneAnswered ? 'voting' : room.phase,
        // Only the person who walked out mid-sentence hands their clock on. If
        // somebody further down the order left, the speaker keeps their time.
        turnEndsAt:
          room.phase !== 'answering' || everyoneAnswered
            ? null
            : wasSpeaking
              ? secondsFromNow(room.settings.answerSeconds)
              : room.turnEndsAt,
        // Somebody walking out can be what closes the round, and the ballot
        // opens on its own clock when it does.
        voteEndsAt:
          room.phase === 'answering' && everyoneAnswered
            ? secondsFromNow(room.settings.voteSeconds)
            : room.voteEndsAt,
      };

      // A room that empties out can decide the match on its own.
      const outcome = outcomeFor(left, null);
      if (!outcome) {
        // They may have been the last vote the ballot was waiting on.
        const closes = left.phase === 'voting' && awaitedVoters(left).length === 0;
        return closes ? resolveBallot(left) : left;
      }

      return {
        ...left,
        outcome,
        phase: 'verdict',
        turnEndsAt: null,
        voteEndsAt: null,
        eliminatedId: null,
        verdictEndsAt: secondsFromNow(left.settings.resultSeconds),
      };
    }

    case 'castVote': {
      if (!room || room.phase !== 'voting' || room.ballotClosed) return room;
      // Locking in twice is not a way to change your mind.
      if (room.voted.includes(action.voterId)) return room;

      const pending: Room = {
        ...room,
        voted: [...room.voted, action.voterId],
        votes: action.targetId
          ? { ...room.votes, [action.voterId]: action.targetId }
          : room.votes,
      };

      // The last vote in is what closes the ballot. Nobody sees a tally before
      // that, so the result screen is the first anyone hears of it.
      return awaitedVoters(pending).length === 0 ? resolveBallot(pending) : pending;
    }

    case 'closeBallot': {
      if (!room || room.phase !== 'voting' || room.ballotClosed) return room;
      // Time is up. Everyone still out is counted as having named nobody.
      return resolveBallot({ ...room, voted: survivors(room).map((p) => p.id) });
    }

    case 'nextRound': {
      // Only ever from a result that is still standing. A clock re-armed on
      // waking can fire against a room that has already moved on, and without
      // this that would throw away a round that had started.
      if (!room || room.phase !== 'verdict' || room.outcome) return room;
      const round = room.round + 1;
      return {
        ...room,
        phase: 'answering',
        round,
        prompt: pickPrompt(room.prompts, round),
        votes: {},
        voted: [],
        ballotClosed: false,
        eliminatedId: null,
        tiebreaker: null,
        turnOrder: turnOrderFor(room.players, round, room.settings.turnsEach),
        turnIndex: 0,
        turnEndsAt: secondsFromNow(room.settings.answerSeconds),
        voteEndsAt: null,
        verdictEndsAt: null,
      };
    }

    case 'spectate':
      if (!room) return room;
      return { ...room, spectating: true };
  }
}
