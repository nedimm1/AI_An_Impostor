/**
 * Local-only room state. Every action here is synchronous and in-memory; the
 * intent is that the same surface later gets wired to a realtime backend
 * without the screens changing.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type PropsWithChildren,
} from 'react';

import { makeId, mockOpeningChat, mockPlayers, PROMPTS, systemMessage } from './mock';
import { DEFAULT_SETTINGS, YOU_ID, type Phase, type Room, type RoomSettings } from './types';

type Action =
  | { type: 'createRoom'; code: string; name: string }
  | { type: 'joinRoom'; code: string; name: string }
  | { type: 'leaveRoom' }
  | { type: 'setSettings'; settings: Partial<RoomSettings> }
  | { type: 'setName'; name: string }
  | { type: 'toggleReady' }
  | { type: 'startGame' }
  | { type: 'sendMessage'; text: string }
  | { type: 'openVote' }
  | { type: 'castVote'; targetId: string }
  | { type: 'reveal' }
  | { type: 'nextRound' }
  | { type: 'backToLobby' };

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

function phaseDeadline(phase: Phase, settings: RoomSettings) {
  if (phase === 'chat') return secondsFromNow(settings.chatSeconds);
  if (phase === 'voting') return secondsFromNow(settings.voteSeconds);
  return null;
}

function newRoom(code: string, name: string, youAreHost: boolean): Room {
  const you = {
    id: YOU_ID,
    name: name || 'You',
    isHost: youAreHost,
    isYou: true,
    isReady: youAreHost,
    connected: true,
  };
  const others = mockPlayers(youAreHost ? 4 : 5, youAreHost);

  return {
    code,
    phase: 'lobby',
    round: 0,
    players: youAreHost ? [you, ...others] : [...others, you],
    messages: [systemMessage(`Room ${code} created. Waiting for players.`)],
    prompt: null,
    votes: {},
    settings: DEFAULT_SETTINGS,
    impostorId: null,
    phaseEndsAt: null,
  };
}

function pickPrompt(round: number) {
  return PROMPTS[round % PROMPTS.length];
}

function reducer(state: State, action: Action): State {
  const { room } = state;

  switch (action.type) {
    case 'createRoom':
      return {
        displayName: action.name,
        room: newRoom(action.code.toUpperCase(), action.name, true),
      };

    case 'joinRoom':
      return {
        displayName: action.name,
        room: newRoom(action.code.toUpperCase(), action.name, false),
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

    case 'setSettings':
      if (!room) return state;
      return { ...state, room: { ...room, settings: { ...room.settings, ...action.settings } } };

    case 'toggleReady':
      if (!room) return state;
      return {
        ...state,
        room: {
          ...room,
          players: room.players.map((p) => (p.isYou ? { ...p, isReady: !p.isReady } : p)),
        },
      };

    case 'startGame': {
      if (!room) return state;
      // The impostor is picked at random here purely so the shell can reveal
      // *someone* at the end. Real selection happens server-side.
      const candidates = room.players.filter((p) => !p.isYou);
      const impostor = candidates[Math.floor(Math.random() * candidates.length)];
      const prompt = pickPrompt(0);

      return {
        ...state,
        room: {
          ...room,
          phase: 'chat',
          round: 1,
          prompt,
          votes: {},
          impostorId: impostor?.id ?? null,
          phaseEndsAt: phaseDeadline('chat', room.settings),
          messages: [
            systemMessage(`Round 1 of ${room.settings.rounds}. One of you is not a person.`),
            ...mockOpeningChat(room.players),
          ],
        },
      };
    }

    case 'sendMessage': {
      if (!room) return state;
      const text = action.text.trim();
      if (!text) return state;
      return {
        ...state,
        room: {
          ...room,
          messages: [
            ...room.messages,
            {
              id: makeId('msg'),
              kind: 'chat',
              playerId: YOU_ID,
              text,
              createdAt: Date.now(),
            },
          ],
        },
      };
    }

    case 'openVote':
      if (!room) return state;
      return {
        ...state,
        room: {
          ...room,
          phase: 'voting',
          votes: {},
          phaseEndsAt: phaseDeadline('voting', room.settings),
        },
      };

    case 'castVote': {
      if (!room) return state;
      // Stand-in for other players' votes so the tally isn't empty.
      const others: Record<string, string> = {};
      const targets = room.players.map((p) => p.id);
      for (const player of room.players) {
        if (player.isYou) continue;
        others[player.id] = targets[Math.floor(Math.random() * targets.length)];
      }
      return {
        ...state,
        room: { ...room, votes: { ...others, [YOU_ID]: action.targetId } },
      };
    }

    case 'reveal':
      if (!room) return state;
      return { ...state, room: { ...room, phase: 'results', phaseEndsAt: null } };

    case 'nextRound': {
      if (!room) return state;
      const round = room.round + 1;
      return {
        ...state,
        room: {
          ...room,
          phase: 'chat',
          round,
          prompt: pickPrompt(round - 1),
          votes: {},
          phaseEndsAt: phaseDeadline('chat', room.settings),
          messages: [
            ...room.messages,
            systemMessage(`Round ${round} of ${room.settings.rounds}.`),
          ],
        },
      };
    }

    case 'backToLobby':
      if (!room) return state;
      return {
        ...state,
        room: {
          ...room,
          phase: 'lobby',
          round: 0,
          prompt: null,
          votes: {},
          impostorId: null,
          phaseEndsAt: null,
          messages: [systemMessage('Back in the lobby.')],
        },
      };
  }
}

type RoomContextValue = State & {
  createRoom: (code: string, name: string) => void;
  joinRoom: (code: string, name: string) => void;
  leaveRoom: () => void;
  setName: (name: string) => void;
  setSettings: (settings: Partial<RoomSettings>) => void;
  toggleReady: () => void;
  startGame: () => void;
  sendMessage: (text: string) => void;
  openVote: () => void;
  castVote: (targetId: string) => void;
  reveal: () => void;
  nextRound: () => void;
  backToLobby: () => void;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const createRoom = useCallback(
    (code: string, name: string) => dispatch({ type: 'createRoom', code, name }),
    []
  );
  const joinRoom = useCallback(
    (code: string, name: string) => dispatch({ type: 'joinRoom', code, name }),
    []
  );
  const leaveRoom = useCallback(() => dispatch({ type: 'leaveRoom' }), []);
  const setName = useCallback((name: string) => dispatch({ type: 'setName', name }), []);
  const setSettings = useCallback(
    (settings: Partial<RoomSettings>) => dispatch({ type: 'setSettings', settings }),
    []
  );
  const toggleReady = useCallback(() => dispatch({ type: 'toggleReady' }), []);
  const startGame = useCallback(() => dispatch({ type: 'startGame' }), []);
  const sendMessage = useCallback((text: string) => dispatch({ type: 'sendMessage', text }), []);
  const openVote = useCallback(() => dispatch({ type: 'openVote' }), []);
  const castVote = useCallback((targetId: string) => dispatch({ type: 'castVote', targetId }), []);
  const reveal = useCallback(() => dispatch({ type: 'reveal' }), []);
  const nextRound = useCallback(() => dispatch({ type: 'nextRound' }), []);
  const backToLobby = useCallback(() => dispatch({ type: 'backToLobby' }), []);

  const value = useMemo(
    () => ({
      ...state,
      createRoom,
      joinRoom,
      leaveRoom,
      setName,
      setSettings,
      toggleReady,
      startGame,
      sendMessage,
      openVote,
      castVote,
      reveal,
      nextRound,
      backToLobby,
    }),
    [
      state,
      createRoom,
      joinRoom,
      leaveRoom,
      setName,
      setSettings,
      toggleReady,
      startGame,
      sendMessage,
      openVote,
      castVote,
      reveal,
      nextRound,
      backToLobby,
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
 * For screens under `/room/[code]` that cannot render without a room. Returns
 * null while the room is missing so the screen can redirect home.
 */
export function useRoom() {
  return useRoomStore().room;
}
