/**
 * The match, run on the game server.
 *
 * The same `MatchTransport` the screens already use, with the other side moved
 * off the phone: the rules, the clocks and the impostor all run in
 * `server/game/`. This file carries messages — it sends what you do and holds
 * the room the server last sent — so no screen changes to go online.
 *
 * Chosen over `useLocalTransport` in `store.tsx` when `EXPO_PUBLIC_GAME_URL` is
 * set, e.g. `ws://localhost:8787/game`.
 *
 * STAYING CONNECTED is most of what is in here, because phones lose their
 * connection constantly and mostly not cleanly:
 *
 * - A dropped connection is retried, and on its way back in the server sends
 *   the room you were in, seat and all.
 * - A connection that dies without closing — a tunnel, a lift — is caught by
 *   silence: the server checks in every few seconds, and a phone that has not
 *   heard anything for a while stops trusting the connection and makes a new
 *   one.
 * - Coming back to the app reconnects straight away rather than waiting for
 *   the phone to notice the old connection is gone.
 * - Whatever you do while disconnected is held and sent once you are back,
 *   stamped with the moment you did it, so the server can throw away anything
 *   that no longer applies rather than letting it land somewhere it should not.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useResumeSignal } from '@/hooks/use-app-state';

import { ServerClock } from './clock';
import type { Profile } from './profile';
import {
  momentOf,
  SILENCE_LIMIT_MS,
  type ClientMessage,
  type ServerMessage,
} from './protocol';
import type { Intent, Matchmaking, MatchTransport, Notice } from './transport';
import type { Room, RoomSize } from './types';

export const GAME_URL = process.env.EXPO_PUBLIC_GAME_URL ?? '';

/** How long to wait before trying again after the connection drops. */
const RECONNECT_MS = 1_500;

/** More held intents than this means something is wrong; the oldest go. */
const MAX_HELD = 20;

/** Closed by the server because this player connected again elsewhere — don't fight it. */
const REPLACED = 4001;

/** The room's deadlines, moved from the server's clock onto this phone's. See `clock.ts`. */
function onLocalClock(room: Room, clock: ServerClock): Room {
  return {
    ...room,
    turnEndsAt: clock.toLocal(room.turnEndsAt),
    voteEndsAt: clock.toLocal(room.voteEndsAt),
    verdictEndsAt: clock.toLocal(room.verdictEndsAt),
    players: room.players.map((p) =>
      p.awayUntil ? { ...p, awayUntil: clock.toLocal(p.awayUntil) } : p
    ),
  };
}

/**
 * How often your typing is sent while you type. Often enough that a drop loses
 * at most a word or two; not every keystroke.
 */
const DRAFT_EVERY_MS = 500;

export function useRemoteTransport(profile: Profile | null): MatchTransport {
  const [room, setRoom] = useState<Room | null>(null);
  const [matchmaking, setMatchmaking] = useState<Matchmaking | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  /** The room size you queued for, so a reconnect can put you back in that queue. Null when not queueing. */
  const wantsMatchRef = useRef<RoomSize | null>(null);
  /** Whether the last `findMatch` asked for the red star; resent with it on reconnect. */
  const starRef = useRef(false);
  /** The latest room, read when stamping an intent with its moment. */
  const roomRef = useRef<Room | null>(null);
  /** The same room as the server sent it, deadlines on the server's clock. */
  const serverRoomRef = useRef<Room | null>(null);
  /** How far this phone's clock is from the server's. Kept across reconnects. */
  const clockRef = useRef(new ServerClock());
  /** Messages that could not be sent because the connection was down. */
  const heldRef = useRef<ClientMessage[]>([]);
  /** Opens a fresh connection now if the current one is not to be trusted. Set by the effect below. */
  const reconnectNowRef = useRef<() => void>(() => {});

  const playerId = profile?.playerId ?? null;
  const resumedAt = useResumeSignal();

  /** Sends now if the connection is up, otherwise holds it for when it is back. */
  const post = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return;
    }
    heldRef.current = [...heldRef.current, message].slice(-MAX_HELD);
  }, []);

  useEffect(() => {
    // The server knows you by the durable id, so there is nothing to connect as
    // until the profile has been read back.
    if (!GAME_URL || !playerId) return;

    let unmounted = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastHeard = Date.now();

    const connect = () => {
      if (unmounted) return;
      if (retry) clearTimeout(retry);

      // Only ever one connection. An old one still hanging around is let go
      // first — cleared from the ref before it closes, so its closing does not
      // start yet another.
      const previous = socketRef.current;
      socketRef.current = null;
      previous?.close();

      const socket = new WebSocket(GAME_URL);
      socketRef.current = socket;
      lastHeard = Date.now();

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        const say = (message: ClientMessage) => socket.send(JSON.stringify(message));

        say({ type: 'hello', playerId });
        // Dropped while queueing: ask again. The server ignores it if you are
        // already in a match, and sends that match instead.
        if (wantsMatchRef.current !== null) {
          say({ type: 'findMatch', seats: wantsMatchRef.current, star: starRef.current });
        }

        // What you did while away, in the order you did it. Each is stamped
        // with its moment, and the server drops the ones that no longer apply.
        const held = heldRef.current;
        heldRef.current = [];
        held.forEach(say);

        setConnected(true);
      };

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        lastHeard = Date.now();

        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }

        switch (message.type) {
          case 'room': {
            if (message.room) wantsMatchRef.current = null;
            clockRef.current.observe(message.serverNow);
            serverRoomRef.current = message.room;
            const next = message.room ? onLocalClock(message.room, clockRef.current) : null;
            roomRef.current = next;
            setRoom(next);
            break;
          }
          case 'matchmaking': {
            const matchmaking = message.matchmaking;
            // A cooldown arrives as a duration; count it down on this phone's clock.
            setMatchmaking(
              matchmaking?.cooldownMs
                ? { ...matchmaking, cooldownEndsAt: Date.now() + matchmaking.cooldownMs }
                : matchmaking
            );
            break;
          }
          case 'ping': {
            socket.send(JSON.stringify({ type: 'pong' } satisfies ClientMessage));

            // A better reading of the clock moves the deadlines already on
            // screen, rather than waiting for the next room to arrive.
            const before = clockRef.current.offset();
            clockRef.current.observe(message.serverNow);
            const serverRoom = serverRoomRef.current;
            if (serverRoom && clockRef.current.offset() !== before) {
              const next = onLocalClock(serverRoom, clockRef.current);
              roomRef.current = next;
              setRoom(next);
            }
            break;
          }
          case 'notice':
            setNotice(message.notice);
            break;
        }
      };

      socket.onclose = (event) => {
        // A connection that has already been replaced must not start another
        // one when it finally closes. Without this, two connections for the
        // same player could keep knocking each other out: each old one closing
        // opened a new one, which replaced the other, which closed…
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        setConnected(false);

        // The server closed this because the same player connected again —
        // another device, or a newer connection from this one. Let that win.
        if (event.code === REPLACED) return;

        retry = setTimeout(connect, RECONNECT_MS);
      };
    };

    // Silence is how a dead connection that never closed is noticed. The
    // server checks in every few seconds, so hearing nothing for this long
    // means nothing is getting through.
    const watchdog = setInterval(() => {
      if (socketRef.current && Date.now() - lastHeard > SILENCE_LIMIT_MS) {
        setConnected(false);
        connect();
      }
    }, 5_000);

    reconnectNowRef.current = () => {
      const socket = socketRef.current;
      // Not heard from the server for a heartbeat or more is not worth trusting
      // after the app has been away — the OS may have killed the connection
      // without telling anyone.
      const stale = Date.now() - lastHeard > SILENCE_LIMIT_MS / 3;
      if (!socket || socket.readyState !== WebSocket.OPEN || stale) connect();
    };

    connect();

    return () => {
      unmounted = true;
      if (retry) clearTimeout(retry);
      clearInterval(watchdog);
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close();
      reconnectNowRef.current = () => {};
    };
  }, [playerId]);

  // Back in the app: check the connection now rather than on the next tick.
  useEffect(() => {
    reconnectNowRef.current();
  }, [resumedAt]);

  const findMatch = useCallback(
    (size: RoomSize, star = false) => {
      wantsMatchRef.current = size;
      starRef.current = star;
      setNotice(null);
      post({ type: 'findMatch', seats: size, star });
    },
    [post]
  );

  const send = useCallback(
    (intent: Intent) => {
      const current = roomRef.current;
      const at = current ? momentOf(current) : '';

      if (intent.type === 'leave') {
        // Cleared here rather than waiting for the server to confirm it. The
        // screen that sent this is usually on its way to the queue, and the
        // queue treats any room it can see as a match to jump into — so a
        // stale one arriving a moment late would put you straight back in the
        // game you just left.
        wantsMatchRef.current = null;
        roomRef.current = null;
        serverRoomRef.current = null;
        setRoom(null);
        setMatchmaking(null);
      }
      post({ type: 'intent', intent, at });
    },
    [post]
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  // The latest typing, and whether a send of it is already scheduled.
  const draftTextRef = useRef<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draft = useCallback((text: string) => {
    draftTextRef.current = text;
    if (draftTimerRef.current) return;

    const flush = () => {
      draftTimerRef.current = null;
      const pending = draftTextRef.current;
      const current = roomRef.current;
      const socket = socketRef.current;
      if (pending === null || !current || !socket || socket.readyState !== WebSocket.OPEN) return;
      draftTextRef.current = null;
      // Not held while offline like an intent is: typing that could not reach
      // the server is no use to it, and the next keystroke sends it again.
      socket.send(JSON.stringify({ type: 'draft', text: pending, at: momentOf(current) } satisfies ClientMessage));
    };

    flush();
    draftTimerRef.current = setTimeout(flush, DRAFT_EVERY_MS);
  }, []);

  useEffect(() => () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
  }, []);

  return useMemo(
    () => ({ room, matchmaking, findMatch, send, connected, draft, notice, dismissNotice }),
    [room, matchmaking, findMatch, send, connected, draft, notice, dismissNotice]
  );
}
