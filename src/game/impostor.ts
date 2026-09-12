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
import {
  answerById,
  currentTurnNumber,
  playerById,
  roundAnswers,
  survivors,
  type Room,
} from './types';

/**
 * Where the impostor is running. Unset means no impostor: the room falls back
 * to stock lines and the game is exactly what it was before. That default
 * matters — a missing server must never be a broken match.
 */
const SERVER_URL = process.env.EXPO_PUBLIC_IMPOSTOR_URL ?? '';

export function impostorEnabled() {
  return SERVER_URL !== '';
}

/** What the impostor is allowed to know about the room. */
export type ImpostorTurn = {
  roomId: string;
  /**
   * The name on its seat. Sent rather than chosen server-side because the
   * matchmaker picks it: an impostor told it is Mr. Green while the room sees Mr. Pink
   * answers to the wrong name in front of everybody, and it is reading a
   * transcript its own lines appear in, so it has to recognise itself.
   */
  name: string;
  prompt: string;
  answerSeconds: number;
  /** This round's lines, in order — the same thing on everybody's screen. */
  roundLines: { name: string; text: string; replyToName: string | null }[];
  /** What it said in earlier rounds, which only it can still see. */
  ownHistory: string[];
  /**
   * Which time round the room this is, 1-based, and how many there are.
   *
   * Sent because turn one and turn three are not the same turn and were being
   * prompted as though they were. On turn one the question is unanswered and
   * answering it is the job; by turn three everybody has answered, the room is
   * talking, and a model still being told to answer the question has nothing
   * left to say and says two words of nothing.
   */
  turnNumber: number;
  turnsEach: number;
  /**
   * Whether anybody has written back at it, and who at whom generally.
   *
   * The transcript used to be flattened to name and text, which threw away
   * the one piece of structure the room can see and the impostor could not:
   * that a line was aimed at somebody. Being replied to and not noticing is
   * the most human-looking mistake there is to make and the least human thing
   * to do, since on a phone the reply is drawn under your own message with
   * your words quoted inside it. It is not subtle and nobody misses it.
   */
  /**
   * Everybody still in the room, itself included.
   *
   * Sent because the transcript is not a roster: a player who walked out or
   * was voted out an hour ago is still all over it, and the impostor turned
   * on one of them twice in a round they had already left. Somebody who has
   * gone cannot answer, cannot be voted for, and cannot take any heat off it.
   */
  stillIn: string[];
  /** The room is talking out a tied vote rather than answering a prompt. */
  tiebreaker: boolean;
  /** It is one of the two the room is deciding between. */
  accused: boolean;
  /**
   * The message this turn is aimed at, or null to answer the room cold.
   *
   * Drawn before the words exist, not after. The room pins a reply under the
   * message it answers whichever way round it happens, so a line written
   * without knowing its target and then attached to one reads exactly as
   * blind as it was — which is the single loudest thing the impostor can do
   * and what it was doing until this was passed through.
   */
  replyTo: { name: string; text: string } | null;
};

/**
 * The room, reduced to a turn.
 *
 * Kept pure and exported so it can be tested without a server: what the
 * impostor is told is a rule of the game, and rules belong under test. The two
 * halves are separate on purpose — the room can only see the round it is on,
 * so previous rounds appear as the impostor's own memory rather than as
 * transcript, and its lines from *this* round arrive in `roundLines` like
 * anybody else's.
 */
export function impostorTurn(room: Room, replyToId: string | null = null): ImpostorTurn {
  const spoken = roundAnswers(room).filter((a) => a.kind === 'answer' && !a.timedOut);
  const target = answerById(room, replyToId);
  const targetAuthor = playerById(room, target?.playerId);

  return {
    roomId: room.id,
    name: playerById(room, room.impostorId)?.name ?? 'you',
    // Already the tiebreaker's own wording when there is one — the reducer
    // swaps it in, so there is only ever one prompt to read.
    prompt: room.prompt,
    answerSeconds: room.settings.answerSeconds,
    turnNumber: currentTurnNumber(room),
    turnsEach: room.settings.turnsEach,
    stillIn: survivors(room).map((p) => p.name),
    tiebreaker: room.tiebreaker !== null,
    accused: room.tiebreaker?.includes(room.impostorId ?? '') ?? false,
    replyTo:
      target && targetAuthor ? { name: targetAuthor.name, text: target.text } : null,
    roundLines: spoken.map((answer) => {
      // Who the line was written at, when it was written at anybody. The room
      // renders this as a quote above the message; the impostor gets the same
      // fact as a name, which is all it needs to notice one aimed at itself.
      const at = playerById(room, answerById(room, answer.replyToId)?.playerId);
      return {
        name: playerById(room, answer.playerId)?.name ?? 'someone',
        text: answer.text,
        replyToName: at?.name ?? null,
      };
    }),
    ownHistory: room.transcript
      .filter(
        (a) =>
          a.kind === 'answer' &&
          a.playerId === room.impostorId &&
          a.round < room.round &&
          !a.timedOut
      )
      .map((a) => a.text),
  };
}

/** What the impostor is allowed to know when the ballot is open. */
export type ImpostorBallot = {
  roomId: string;
  name: string;
  round: number;
  prompt: string;
  roundLines: { name: string; text: string }[];
  /** Everyone it can name. Never itself — that is not a vote, it is a bug. */
  candidates: string[];
  /** The two a tied vote put up, if the room is on its second ballot. */
  accused: string[];
};

/**
 * The room, reduced to a ballot.
 *
 * The impostor is the one player in the room with nothing to work out: it
 * knows every other seat is a person. So this carries no more than the room
 * does — what was said, and who is still in — because the question it is
 * answering is not "who is the AI" but "who do I want gone", and the second
 * one needs less.
 */
export function impostorBallot(room: Room): ImpostorBallot {
  const alive = survivors(room);
  return {
    roomId: room.id,
    name: playerById(room, room.impostorId)?.name ?? 'you',
    round: room.round,
    prompt: room.prompt,
    roundLines: roundAnswers(room)
      .filter((a) => a.kind === 'answer' && !a.timedOut)
      .map((answer) => ({
        name: room.players.find((p) => p.id === answer.playerId)?.name ?? 'someone',
        text: answer.text,
      })),
    candidates: alive.filter((p) => p.id !== room.impostorId).map((p) => p.name),
    accused: (room.tiebreaker ?? [])
      .map((id) => playerById(room, id)?.name)
      .filter((name): name is string => name !== undefined),
  };
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
