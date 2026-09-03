/**
 * Local-only session state. Every action here is synchronous and in-memory; the
 * intent is that the same surface later gets wired to a realtime backend
 * without the screens changing.
 *
 * The match loop: everyone still in answers the prompt in turn (forty-five seconds
 * each), everyone votes, the most-voted player is removed. Repeat until the
 * impostor is caught or it has outlasted all but one human.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type PropsWithChildren,
} from 'react';

import { makeId, shuffledPrompts } from './mock';
import {
  currentTurnId,
  DEFAULT_SETTINGS,
  humansAlive,
  survivors,
  tiebreakerPrompt,
  voteResult,
  YOU_ID,
  type Outcome,
  type Player,
  type Room,
} from './types';

type Action =
  | { type: 'startMatch'; id: string; name: string; strangers: Player[] }
  | { type: 'answerTurn'; text: string; timedOut: boolean; replyToId: string | null }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'castVote'; targetId: string | null }
  | { type: 'resolveVote' }
  | { type: 'nextRound' }
  | { type: 'spectate' }
  | { type: 'leaveRoom' }
  | { type: 'setName'; name: string };

type State = {
  displayName: string;
  room: Room | null;
};

const initialState: State = {
  displayName: '',
  room: null,
};

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
function matchedRoom(id: string, name: string, strangers: Player[]): Room {
  const you: Player = {
    id: YOU_ID,
    name: name || 'You',
    isYou: true,
    connected: true,
    eliminated: false,
  };

  // Your seat is random so you aren't always the first name in the room.
  const players = [...strangers];
  players.splice(Math.floor(Math.random() * (players.length + 1)), 0, you);

  const impostor = strangers[Math.floor(Math.random() * strangers.length)];
  const prompts = shuffledPrompts();

  return {
    id,
    phase: 'answering',
    round: 1,
    players,
    answers: [],
    turnOrder: turnOrderFor(players, 1, DEFAULT_SETTINGS.turnsEach),
    turnIndex: 0,
    turnEndsAt: secondsFromNow(DEFAULT_SETTINGS.answerSeconds),
    voteEndsAt: null,
    prompt: pickPrompt(prompts, 1),
    prompts,
    votes: {},
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
    ballotClosed: false,
    eliminatedId: null,
    turnOrder: tiebreakerTurnOrder(room, tied),
    turnIndex: 0,
    turnEndsAt: secondsFromNow(room.settings.answerSeconds),
    voteEndsAt: null,
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

function reducer(state: State, action: Action): State {
  const { room } = state;

  switch (action.type) {
    case 'startMatch':
      return {
        displayName: action.name,
        room: matchedRoom(action.id, action.name, action.strangers),
      };

    case 'leaveRoom':
      return { ...state, room: null };

    case 'setName': {
      if (!room) return { ...state, displayName: action.name };
      return {
        displayName: action.name,
        room: {
          ...room,
          players: room.players.map((p) => (p.isYou ? { ...p, name: action.name } : p)),
        },
      };
    }

    case 'answerTurn': {
      if (!room || room.phase !== 'answering') return state;
      const speakerId = currentTurnId(room);
      if (!speakerId) return state;

      // A reply only holds if its target is still on screen — ids from an
      // earlier round point at answers that have already been cleared.
      const replyToId =
        !action.timedOut && room.answers.some((a) => a.id === action.replyToId)
          ? action.replyToId
          : null;

      const answers = [
        ...room.answers,
        {
          id: makeId('ans'),
          kind: 'answer' as const,
          playerId: speakerId,
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
        ...state,
        room: {
          ...room,
          answers,
          turnIndex,
          phase: everyoneAnswered ? 'voting' : 'answering',
          turnEndsAt: everyoneAnswered ? null : secondsFromNow(room.settings.answerSeconds),
          voteEndsAt: everyoneAnswered ? secondsFromNow(room.settings.voteSeconds) : null,
        },
      };
    }

    case 'playerLeft': {
      if (!room || room.outcome) return state;
      const player = room.players.find((p) => p.id === action.playerId);
      if (!player || !player.connected || player.eliminated) return state;

      const wasSpeaking = currentTurnId(room) === action.playerId;
      const { turnOrder, turnIndex } = turnOrderWithout(room, action.playerId);
      const everyoneAnswered = turnIndex >= turnOrder.length;

      // Whatever they had voted for goes with them.
      const votes = { ...room.votes };
      delete votes[action.playerId];

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
        answers: [
          ...room.answers,
          {
            id: makeId('out'),
            kind: 'departure' as const,
            playerId: action.playerId,
            text: '',
            timedOut: false,
            inTiebreaker: room.tiebreaker !== null,
            replyToId: null,
            createdAt: Date.now(),
          },
        ],
        votes,
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
      if (!outcome) return { ...state, room: left };

      return {
        ...state,
        room: {
          ...left,
          outcome,
          phase: 'verdict',
          turnEndsAt: null,
          voteEndsAt: null,
          eliminatedId: null,
        },
      };
    }

    case 'castVote': {
      if (!room) return state;
      // Stand-in for the other players' votes so the tally isn't empty. A null
      // target means you had no vote to cast — you are out — and only the rest
      // of the room is deciding.
      const alive = survivors(room);
      const votes: Record<string, string> = {};
      for (const voter of alive) {
        if (voter.isYou) continue;
        const options = alive.filter((t) => t.id !== voter.id);
        if (options.length === 0) continue;
        votes[voter.id] = options[Math.floor(Math.random() * options.length)].id;
      }
      if (action.targetId) votes[YOU_ID] = action.targetId;

      // The ballot is closed. What is left on the clock is the reveal.
      return {
        ...state,
        room: {
          ...room,
          votes,
          ballotClosed: true,
          voteEndsAt: secondsFromNow(room.settings.revealSeconds),
        },
      };
    }

    case 'resolveVote': {
      if (!room) return state;
      const result = voteResult(room);

      // A first tie opens a tiebreaker. A tie in the tiebreaker itself removes
      // nobody — the round is spent and the match moves on.
      if (result.kind === 'tied' && !room.tiebreaker) {
        return { ...state, room: startTiebreaker(room, result.playerIds) };
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
      };

      return { ...state, room: { ...resolved, outcome: outcomeFor(resolved, eliminatedId) } };
    }

    case 'nextRound': {
      if (!room) return state;
      const round = room.round + 1;
      return {
        ...state,
        room: {
          ...room,
          phase: 'answering',
          round,
          prompt: pickPrompt(room.prompts, round),
          answers: [],
          votes: {},
          ballotClosed: false,
          eliminatedId: null,
          tiebreaker: null,
          turnOrder: turnOrderFor(room.players, round, room.settings.turnsEach),
          turnIndex: 0,
          turnEndsAt: secondsFromNow(room.settings.answerSeconds),
          voteEndsAt: null,
        },
      };
    }

    case 'spectate':
      if (!room) return state;
      return { ...state, room: { ...room, spectating: true } };
  }
}

type RoomContextValue = State & {
  startMatch: (id: string, name: string, strangers: Player[]) => void;
  answerTurn: (text: string, timedOut: boolean, replyToId?: string | null) => void;
  playerLeft: (playerId: string) => void;
  castVote: (targetId: string | null) => void;
  resolveVote: () => void;
  nextRound: () => void;
  spectate: () => void;
  leaveRoom: () => void;
  setName: (name: string) => void;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const startMatch = useCallback(
    (id: string, name: string, strangers: Player[]) =>
      dispatch({ type: 'startMatch', id, name, strangers }),
    []
  );
  const answerTurn = useCallback(
    (text: string, timedOut: boolean, replyToId: string | null = null) =>
      dispatch({ type: 'answerTurn', text, timedOut, replyToId }),
    []
  );
  const playerLeft = useCallback(
    (playerId: string) => dispatch({ type: 'playerLeft', playerId }),
    []
  );
  const castVote = useCallback(
    (targetId: string | null) => dispatch({ type: 'castVote', targetId }),
    []
  );
  const resolveVote = useCallback(() => dispatch({ type: 'resolveVote' }), []);
  const nextRound = useCallback(() => dispatch({ type: 'nextRound' }), []);
  const spectate = useCallback(() => dispatch({ type: 'spectate' }), []);
  const leaveRoom = useCallback(() => dispatch({ type: 'leaveRoom' }), []);
  const setName = useCallback((name: string) => dispatch({ type: 'setName', name }), []);

  const value = useMemo(
    () => ({
      ...state,
      startMatch,
      answerTurn,
      playerLeft,
      castVote,
      resolveVote,
      nextRound,
      spectate,
      leaveRoom,
      setName,
    }),
    [
      state,
      startMatch,
      answerTurn,
      playerLeft,
      castVote,
      resolveVote,
      nextRound,
      spectate,
      leaveRoom,
      setName,
    ]
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoomStore() {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoomStore must be used inside a RoomProvider');
  }
  return context;
}

/**
 * For screens under `/room/[id]` that cannot render without a room. Returns
 * null while the room is missing so the screen can redirect home.
 */
export function useRoom() {
  return useRoomStore().room;
}
