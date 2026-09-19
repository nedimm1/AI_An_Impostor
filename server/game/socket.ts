/**
 * Phones in, rooms out.
 *
 * The one file that knows about WebSockets. It turns messages from a phone into
 * calls on the lobby and the match, and turns changes in those back into
 * messages. Nothing about the game is decided here.
 *
 * A connection is anonymous until it says `hello` with its player id. From then
 * on that id is who it is, and if the same id connects again — a phone that
 * dropped off the Wi-Fi and came back — the new connection simply replaces the
 * old one and is sent the room it was already in.
 */

import type { Server } from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  GAME_PATH,
  HEARTBEAT_MS,
  SILENCE_LIMIT_MS,
  type ClientMessage,
  type ServerMessage,
} from '../../src/game/protocol';
import { isRoomSize } from '../../src/game/types';

import { Lobby } from './lobby';
import type { ImpostorModel } from './match';
import { Logbook } from './transcript';

/** A connection that has not said who it is by now is closed. */
const HELLO_TIMEOUT_MS = 5_000;

/** Messages bigger than this are not an answer somebody typed. */
const MAX_MESSAGE_BYTES = 16 * 1024;

/** Player ids come from `Crypto.randomUUID()` on the phone. Anything else is refused. */
const PLAYER_ID = /^[A-Za-z0-9-]{8,64}$/;

function parse(raw: unknown): ClientMessage | null {
  try {
    const message = JSON.parse(String(raw));
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') return null;
    return message as ClientMessage;
  } catch {
    return null;
  }
}

export function attachGame(server: Server, model: ImpostorModel) {
  const sockets = new Map<string, WebSocket>();

  const send = (playerId: string, message: ServerMessage) => {
    const socket = sockets.get(playerId);
    if (socket && socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  const sendRoom = (playerId: string) => {
    const match = lobby.matchFor(playerId);
    send(playerId, {
      type: 'room',
      room: match ? match.view(playerId) : null,
      serverNow: Date.now(),
    });
  };

  /*
   * The server's own record of every match (`transcript.ts`). Driven from the
   * lobby's events rather than from inside the match, so the match stays a
   * thing that can be run in a test with nothing attached to it — and read
   * before the phones are sent anything, so a line is in the terminal by the
   * time it is on a screen.
   */
  const logbook = new Logbook();

  const lobby = new Lobby(model, {
    matchChanged: (match) => {
      logbook.sync(match);
      match.players().forEach(sendRoom);
    },
    queueChanged: (waiting, progress) =>
      waiting.forEach((id) => send(id, { type: 'matchmaking', matchmaking: progress })),
    leftQueue: (id) => send(id, { type: 'matchmaking', matchmaking: null }),
    matchEnded: (match, playerIds) => {
      logbook.finish(match);
      playerIds.forEach(sendRoom);
    },
  });

  const wss = new WebSocketServer({ server, path: GAME_PATH, maxPayload: MAX_MESSAGE_BYTES });

  /** When each connection was last heard from. */
  const lastHeard = new WeakMap<WebSocket, number>();

  /*
   * The heartbeat. A connection that dies without closing — the phone went into
   * a tunnel — looks exactly like a quiet player until something is sent to it.
   * So every connection is checked in on, and one that has not answered for too
   * long is cut: that is what turns a silent phone into a disconnected one, and
   * starts its grace period (`Lobby.disconnected`).
   */
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const socket of wss.clients) {
      if (now - (lastHeard.get(socket) ?? now) > SILENCE_LIMIT_MS) {
        socket.terminate();
        continue;
      }
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'ping', serverNow: Date.now() } satisfies ServerMessage));
      }
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  wss.on('connection', (socket) => {
    let playerId: string | null = null;
    lastHeard.set(socket, Date.now());

    const helloTimer = setTimeout(() => {
      if (!playerId) socket.close(4000, 'say hello first');
    }, HELLO_TIMEOUT_MS);

    socket.on('message', (raw) => {
      // Anything at all counts as being there, not only a pong.
      lastHeard.set(socket, Date.now());
      const message = parse(raw);
      if (!message || message.type === 'pong') return;

      if (message.type === 'hello') {
        if (playerId || typeof message.playerId !== 'string' || !PLAYER_ID.test(message.playerId)) {
          return;
        }
        playerId = message.playerId;
        clearTimeout(helloTimer);

        // The same player on a new connection: the new one wins.
        const previous = sockets.get(playerId);
        if (previous && previous !== socket) previous.close(4001, 'replaced by a newer connection');
        sockets.set(playerId, socket);

        console.log(`  game  ${playerId.slice(0, 8)} connected`);
        if (lobby.reconnected(playerId)) {
          send(playerId, { type: 'notice', notice: 'removedForBeingAway' });
        }
        sendRoom(playerId);
        const queuedFor = lobby.queuedFor(playerId);
        if (queuedFor !== null) {
          send(playerId, { type: 'matchmaking', matchmaking: lobby.progress(queuedFor) });
        }
        return;
      }

      // Everything past here needs to know who is asking.
      if (!playerId) return;

      if (message.type === 'findMatch') {
        if (lobby.matchFor(playerId)) {
          sendRoom(playerId);
          return;
        }
        // Only the sizes the game offers. Anything else is not a request a
        // real phone makes.
        if (!isRoomSize(message.seats)) return;
        lobby.join(playerId, message.seats);
        return;
      }

      if (message.type === 'draft') {
        if (typeof message.text !== 'string' || typeof message.at !== 'string') return;
        lobby.matchFor(playerId)?.draft(playerId, message.text, message.at);
        return;
      }

      if (message.type === 'intent' && message.intent && typeof message.intent === 'object') {
        const match = lobby.matchFor(playerId);

        if (message.intent.type === 'leave') {
          // Out of a match, or out of the queue — whichever they were in.
          if (match) lobby.leaveMatch(playerId);
          else lobby.cancel(playerId);
          sendRoom(playerId);
          return;
        }

        match?.handle(
          playerId,
          message.intent,
          typeof message.at === 'string' ? message.at : undefined
        );
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (!playerId || sockets.get(playerId) !== socket) return;
      sockets.delete(playerId);
      console.log(`  game  ${playerId.slice(0, 8)} disconnected`);

      // Out of any queue now; a seat in a match is kept for the grace period.
      lobby.disconnected(playerId);
    });
  });

  return wss;
}
