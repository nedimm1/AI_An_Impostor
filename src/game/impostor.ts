/**
 * The app's side of the impostor.
 *
 * Everything that decides what the impostor says — the persona, the prompt,
 * the model, the key — is in `server/`, deliberately outside `src/` so none of
 * it can be read out of a shipped bundle. What is left here is the part that
 * is safe to ship: turn the room into the handful of facts the impostor is
 * allowed to know, ask for a line, and cope when there isn't one.
 *
 * This is written against a URL rather than a socket because that is all the
 * local proxy is. When there is a real backend the impostor's turn stops being
 * a request from this device at all — the server already knows whose turn it
 * is — and this module goes away. Nothing else has to move, which is the whole
 * reason the transport seam exists.
 */

import { noteImpostorFailure, noteImpostorShape, noteImpostorVoteFallback } from './round-log';
import { impostorBallot, impostorTurn } from './impostor-payload';
import { survivors, type Room } from './types';

// Re-exported so nothing that already imports these from here has to change.
export { impostorBallot, impostorTurn } from './impostor-payload';
export type { ImpostorBallot, ImpostorTurn } from './impostor-payload';

/**
 * Where the impostor is running. Unset means no impostor: the room falls back
 * to stock lines and the game is exactly what it was before. That default
 * matters — a missing server must never be a broken match.
 */
const SERVER_URL = process.env.EXPO_PUBLIC_IMPOSTOR_URL ?? '';

export function impostorEnabled() {
  return SERVER_URL !== '';
}

/**
 * Ask who it votes for, as a player id.
 *
 * Null for every failure, including a name that is not anybody — the caller
 * votes at random instead, which is what the rest of the room is doing and so
 * is indistinguishable from it.
 */
export async function requestImpostorVote(
  room: Room,
  timeoutMs: number
): Promise<string | null> {
  if (!impostorEnabled()) {
    noteImpostorVoteFallback('no impostor url configured');
    return null;
  }

  const ballot = impostorBallot(room);
  if (ballot.candidates.length === 0) {
    noteImpostorVoteFallback('nobody left to vote for');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${SERVER_URL}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ballot),
      signal: controller.signal,
    });
    if (!response.ok) {
      noteImpostorVoteFallback(
        response.status === 502 ? 'model failed upstream' : `proxy said ${response.status}`
      );
      return null;
    }

    const body = (await response.json()) as { name?: string | null };
    if (typeof body.name !== 'string') {
      noteImpostorVoteFallback('no name came back');
      return null;
    }

    // Back to a seat. The name is checked against the room rather than
    // trusted, since a vote for somebody who is not in it would be dropped
    // silently by the reducer and read as an abstention nobody chose.
    const target = survivors(room).find(
      (p) => p.id !== room.impostorId && p.name.toLowerCase() === body.name!.toLowerCase()
    );
    if (!target) noteImpostorVoteFallback('voted for somebody not in the room');
    else noteImpostorVoteFallback(null);
    return target?.id ?? null;
  } catch {
    noteImpostorVoteFallback(
      controller.signal.aborted ? 'too slow — deadline passed' : 'server unreachable'
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask for a line.
 *
 * Returns null for every kind of failure — server down, key rejected, model
 * refused, empty completion, took too long. There is exactly one caller and it
 * treats null the same way in every case, because from inside the room there
 * is no difference: either a player said something or they didn't.
 *
 * The deadline is the turn itself. A line that arrives after the clock has
 * gone is not late, it is nothing — so the request is abandoned rather than
 * left to resolve into a message the room has already moved past.
 */
export async function requestImpostorAnswer(
  room: Room,
  timeoutMs: number,
  replyToId: string | null = null
): Promise<string | null> {
  // Anything left over from a turn that was abandoned is not this turn's
  // reason, and must not be printed as though it were.
  noteImpostorFailure(null);

  if (!impostorEnabled()) {
    noteImpostorFailure('no impostor url configured');
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${SERVER_URL}/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(impostorTurn(room, replyToId)),
      signal: controller.signal,
    });
    if (!response.ok) {
      // 502 is the proxy saying the model failed; anything else is the proxy
      // itself. Worth telling apart — one is a bad model day, the other is a
      // bad address.
      noteImpostorFailure(
        response.status === 502 ? 'model failed upstream' : `proxy said ${response.status}`
      );
      return null;
    }

    const body = (await response.json()) as {
      text?: string | null;
      shape?: Record<string, unknown> | null;
    };

    // Kept for the round log to print beside the line, and for nothing else.
    // What the impostor was drawn to do is the half of its turn that does not
    // show up on screen, and it is the half worth reading afterwards.
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    noteImpostorShape(body.shape ?? null, text);

    if (text === '') noteImpostorFailure('model returned nothing');
    return text === '' ? null : text;
  } catch {
    // The room still cannot tell these apart, and must not. The log can.
    noteImpostorFailure(
      controller.signal.aborted ? 'too slow — deadline passed' : 'server unreachable'
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
