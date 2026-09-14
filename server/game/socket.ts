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

import { GAME_PATH, type ClientMessage, type ServerMessage } from '../../src/game/protocol';
import { isRoomSize } from '../../src/game/types';

import { Lobby } from './lobby';
import type { ImpostorModel } from './match';

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

  const lobby = new Lobby(model, {
    matchChanged: (match) => match.players().forEach(sendRoom),
    queueChanged: (waiting, progress) =>
      waiting.forEach((id) => send(id, { type: 'matchmaking', matchmaking: progress })),
    leftQueue: (id) => send(id, { type: 'matchmaking', matchmaking: null }),
    matchEnded: (_match, playerIds) => playerIds.forEach(sendRoom),
  });

  const wss = new WebSocketServer({ server, path: GAME_PATH, maxPayload: MAX_MESSAGE_BYTES });

  wss.on('connection', (socket) => {
    let playerId: string | null = null;

    const helloTimer = setTimeout(() => {
      if (!playerId) socket.close(4000, 'say hello first');
    }, HELLO_TIMEOUT_MS);

    socket.on('message', (raw) => {
      const message = parse(raw);
      if (!message) return;

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

      if (message.type === 'intent' && message.intent && typeof message.intent === 'object') {
        const match = lobby.matchFor(playerId);

        if (message.intent.type === 'leave') {
          // Out of a match, or out of the queue — whichever they were in.
          if (match) lobby.leaveMatch(playerId);
          else lobby.cancel(playerId);
          sendRoom(playerId);
          return;
        }

        match?.handle(playerId, message.intent);
      }
    });

    socket.on('close', () => {
      clearTimeout(helloTimer);
      if (!playerId || sockets.get(playerId) !== socket) return;
      sockets.delete(playerId);
      console.log(`  game  ${playerId.slice(0, 8)} disconnected`);

      // Waiting in a queue you are not connected to is waiting for nothing.
      // A seat in a running match is kept: a dropped connection is not a
      // decision to leave, and the turns simply run out until they are back.
      lobby.cancel(playerId);
    });
  });

  return wss;
}
