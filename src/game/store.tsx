/**
 * Local-only session state. Every action here is synchronous and in-memory; the
 * intent is that the same surface later gets wired to a realtime backend
 * without the screens changing.
 *
 * The match loop: everyone still in answers the prompt in turn (one minute
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
  votedOutId,
  YOU_ID,
  type Outcome,
  type Player,
  type Room,
} from './types';

type Action =
  | { type: 'startMatch'; id: string; name: string; strangers: Player[] }
  | { type: 'answerTurn'; text: string; timedOut: boolean }
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
  const alive = players.filter((p) => !p.eliminated).map((p) => p.id);
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
    prompt: pickPrompt(prompts, 1),
    prompts,
    votes: {},
    eliminatedId: null,
    outcome: null,
    spectating: false,
    impostorId: impostor?.id ?? null,
    settings: { ...DEFAULT_SETTINGS, playerCount: players.length },
  };
}

/**
 * Decides the match after a vote resolves. Catching the impostor ends it
 * immediately; otherwise the impostor wins the moment it is down to one human,
 * because a lone human can always be outvoted.
 */
function outcomeFor(room: Room, eliminatedId: string | null): Outcome | null {
  if (eliminatedId && eliminatedId === room.impostorId) return 'humans';
  if (humansAlive(room) <= 1) return 'impostor';
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

      const answers = [
        ...room.answers,
        {
          id: makeId('ans'),
          playerId: speakerId,
          text: action.text.trim(),
          timedOut: action.timedOut,
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
        },
      };
    }

    case 'castVote': {
      if (!room) return state;
      // Stand-in for the other players' votes so the tally isn't empty. A null
      // target means you are out and only the survivors are voting.
      const alive = room.players.filter((p) => !p.eliminated);
      const votes: Record<string, string> = {};
      for (const voter of alive) {
        if (voter.isYou) continue;
        const targets = alive.filter((t) => t.id !== voter.id);
        votes[voter.id] = targets[Math.floor(Math.random() * targets.length)].id;
      }
      if (action.targetId) votes[YOU_ID] = action.targetId;

      return { ...state, room: { ...room, votes } };
    }

    case 'resolveVote': {
      if (!room) return state;
      const eliminatedId = votedOutId(room);

      const resolved: Room = {
        ...room,
        players: eliminatedId
          ? room.players.map((p) => (p.id === eliminatedId ? { ...p, eliminated: true } : p))
          : room.players,
        eliminatedId,
        phase: 'verdict',
        turnEndsAt: null,
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
          eliminatedId: null,
          turnOrder: turnOrderFor(room.players, round, room.settings.turnsEach),
          turnIndex: 0,
          turnEndsAt: secondsFromNow(room.settings.answerSeconds),
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
  answerTurn: (text: string, timedOut: boolean) => void;
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
    (text: string, timedOut: boolean) => dispatch({ type: 'answerTurn', text, timedOut }),
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
