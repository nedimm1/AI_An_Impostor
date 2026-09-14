/**
 * The match, run on the game server.
 *
 * The same `MatchTransport` the screens already use, with the other side moved
 * off the phone: the rules, the clocks, the stand-ins and the impostor all run
 * in `server/game/`. This file only carries messages — it sends what you do
 * and holds the room the server last sent — so no screen changes to go online.
 *
 * Chosen over `useLocalTransport` in `store.tsx` when `EXPO_PUBLIC_GAME_URL` is
 * set, e.g. `ws://localhost:8787/game`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Profile } from './profile';
import type { ClientMessage, ServerMessage } from './protocol';
import type { Intent, Matchmaking, MatchTransport } from './transport';
import type { Room } from './types';

export const GAME_URL = process.env.EXPO_PUBLIC_GAME_URL ?? '';

/** How long to wait before trying again after the connection drops. */
const RECONNECT_MS = 1_500;

/**
 * The room's deadlines, moved from the server's clock onto this phone's.
 *
 * Every deadline is an absolute time on the server's clock, and a phone's clock
 * can be seconds off it — enough that a turn would look like it had ten
 * seconds left when the server was about to end it. The server stamps each
 * room with its own `now`, so the gap between the two clocks is measured on
 * every message and applied here, before any screen counts down against it.
 */
function onLocalClock(room: Room, serverNow: number): Room {
  const offset = Date.now() - serverNow;
  const shift = (t: number | null) => (t === null ? null : t + offset);
  return {
    ...room,
    turnEndsAt: shift(room.turnEndsAt),
    voteEndsAt: shift(room.voteEndsAt),
    verdictEndsAt: shift(room.verdictEndsAt),
  };
}

export function useRemoteTransport(profile: Profile | null): MatchTransport {
  const [room, setRoom] = useState<Room | null>(null);
  const [matchmaking, setMatchmaking] = useState<Matchmaking | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  /** Whether you asked for a match, so a reconnect can put you back in the queue. */
  const wantsMatchRef = useRef(false);

  const playerId = profile?.playerId ?? null;

  const post = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    // The server knows you by the durable id, so there is nothing to connect as
    // until the profile has been read back.
    if (!GAME_URL || !playerId) return;

    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const socket = new WebSocket(GAME_URL);
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'hello', playerId } satisfies ClientMessage));
        // Dropped while queueing: ask again. The server ignores it if you are
        // already in a match, and sends that match instead.
        if (wantsMatchRef.current) {
          socket.send(JSON.stringify({ type: 'findMatch' } satisfies ClientMessage));
        }
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (message.type === 'room') {
          if (message.room) wantsMatchRef.current = false;
          setRoom(message.room ? onLocalClock(message.room, message.serverNow) : null);
        } else if (message.type === 'matchmaking') {
          setMatchmaking(message.matchmaking);
        }
      };

      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        // Keep trying while the app is open. The room you were in is kept on
        // the server and comes back with the next `hello`.
        if (!closed) retry = setTimeout(connect, RECONNECT_MS);
      };
    };

    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [playerId]);

  const findMatch = useCallback(() => {
    wantsMatchRef.current = true;
    post({ type: 'findMatch' });
  }, [post]);

  const send = useCallback(
    (intent: Intent) => {
      if (intent.type === 'leave') {
        // Cleared here rather than waiting for the server to confirm it. The
        // screen that sent this is usually on its way to the queue, and the
        // queue treats any room it can see as a match to jump into — so a
        // stale one arriving a moment late would put you straight back in the
        // game you just left.
        wantsMatchRef.current = false;
        setRoom(null);
        setMatchmaking(null);
      }
      post({ type: 'intent', intent });
    },
    [post]
  );

  return useMemo(
    () => ({ room, matchmaking, findMatch, send }),
    [room, matchmaking, findMatch, send]
  );
}
