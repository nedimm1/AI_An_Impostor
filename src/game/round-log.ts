/**
 * The round, printed as it happens.
 *
 * This exists to be read by a person afterwards. Watching the impostor play
 * on a phone tells you what it said; it does not tell you what it was given
 * or what it was drawn to do, and without those two the only available
 * feedback is "that line was off", which is not something you can act on.
 *
 * So each line goes to the console as it lands, in order, with the things
 * that are invisible on screen made visible: which seat is the impostor,
 * what each line was written at, who ran out of time, and — on the
 * impostor's own lines — the stance, the pushback and the name rule it was
 * working under.
 *
 * Development only. `__DEV__` is false in a production bundle and the whole
 * thing compiles out, so this is not a `TEST_MODE` switch and does not add a
 * fifth place where the game behaves differently.
 */

import { useEffect, useRef } from 'react';

import type { Room } from './types';
import { playerById, roundAnswers, voteResult } from './types';

/**
 * Where the log actually goes.
 *
 * `console.log` in an app has nowhere to be read any more. React Native
 * stopped forwarding logs to the Metro terminal in 0.77, so they exist only
 * in React Native DevTools — a browser tab you have to keep open beside the
 * phone you are already holding, which is exactly the amount of friction
 * that stops a log being read.
 *
 * The impostor server is a terminal that is already open and already
 * printing the other half of this, so the round is posted there and the two
 * halves end up in one place. It goes to the same address the impostor does
 * because that is the one this device is known to be able to reach; with no
 * impostor there is no terminal to print to and this quietly does nothing.
 */
const SINK = process.env.EXPO_PUBLIC_IMPOSTOR_URL ?? '';

/** Bounded, because a server that is not listening must not become a leak. */
const MAX_QUEUED = 200;

let queued: string[] = [];
let sending: ReturnType<typeof setTimeout> | null = null;

function send() {
  sending = null;
  const lines = queued;
  queued = [];
  // Fire and forget. A log that can fail the round it is logging is worse
  // than no log at all.
  fetch(`${SINK}/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lines }),
  }).catch(() => {});
}

/**
 * One line of the log, to the console and to the terminal both.
 *
 * Batched on a short timer rather than sent per line, because a turn landing
 * prints a handful at once and each one would otherwise be its own request
 * from a phone.
 */
function print(line: string) {
  console.log(line);
  if (!SINK) return;
  if (queued.length < MAX_QUEUED) queued.push(line);
  sending ??= setTimeout(send, 50);
}

/*
 * One line the moment the bundle loads, so the terminal says whether it is
 * being talked to at all. Without it a silent log has three possible causes
 * that look identical from the other end — a stale bundle, an address the
 * device cannot reach, and a round that genuinely printed nothing.
 */
if (__DEV__) print(`── log connected${SINK ? '' : ' (no impostor url — nothing will be sent)'}`);

/** What the server drew for a line, sent back purely so it can be printed. */
export type ImpostorShape = {
  stance?: string | null;
  pushback?: string | null;
  nameUse?: string | null;
  length?: string;
  react?: boolean;
  answering?: boolean;
  /** The line had a name in it and was asked for again without one. */
  renamed?: boolean;
  /** The line repeated something it had already sent, and was asked again. */
  repeated?: boolean;
};

/**
 * Held against the words it produced, rather than simply held.
 *
 * It arrives before the line does — the model answers a second or two into
 * the turn and the room shows the words later, on the impostor's own clock —
 * so it has to wait somewhere. Keeping only the latest one was wrong: a turn
 * that gets requested twice, or a line that never lands, leaves a draw behind
 * that then prints against somebody else's message. A log that misattributes
 * is worse than no log, because it is the thing you reason from afterwards.
 *
 * Keyed by the text, so a shape can only ever be printed against the line it
 * belongs to, and bounded because this is a debugging aid and not a store.
 */
const shapes = new Map<string, ImpostorShape>();

export function noteImpostorShape(shape: ImpostorShape | null, text: string | null) {
  if (!shape || !text) return;
  if (shapes.size > 20) shapes.clear();
  shapes.set(text.trim(), shape);
}

/**
 * Why the room was given a stock line instead of the model's.
 *
 * `requestImpostorAnswer` collapses every failure to null on purpose — from
 * inside the room there is genuinely no difference between a model that
 * refused and a server that was never started, and the game must not behave
 * differently. The log is the one place the difference matters, and it is the
 * difference between "Gemma wrote that" and "Gemma was never asked". Two
 * rounds were spent judging a model on `mock.ts` for want of this line.
 *
 * Recorded in two steps because the reason is known when the call fails and
 * the stock line is not chosen until afterwards.
 */
let pendingFallback: string | null = null;

/** The impostor's ballot fell back to a random vote, and this is why. */
let voteFallback: string | null = null;

export function noteImpostorVoteFallback(reason: string | null) {
  voteFallback = reason;
}

/**
 * The model did not answer, and this is why. Null clears it.
 *
 * Cleared at the start of every request, not only when one fails: a turn that
 * is cancelled after failing leaves its reason behind, and the next stock line
 * would then be labelled with the previous turn's excuse. This file's whole
 * position is that a log which misattributes is worse than no log.
 */
export function noteImpostorFailure(reason: string | null) {
  pendingFallback = reason;
}

/** Bind that reason to the stock line the room was handed instead. */
export function noteImpostorFallback(text: string | null) {
  if (!text || !pendingFallback) return;
  if (fallbacks.size > 20) fallbacks.clear();
  fallbacks.set(text.trim(), pendingFallback);
  pendingFallback = null;
}

/** Keyed by text, exactly like the shapes, and bounded for the same reason. */
const fallbacks = new Map<string, string>();

/** Why this line is a stock one, or null if the model actually wrote it. */
export function fallbackFor(text: string): string | null {
  return fallbacks.get(text.trim()) ?? null;
}

function shapeNote(shape: ImpostorShape | null) {
  if (!shape) return '';
  const parts = [
    shape.pushback ? `pushback=${shape.pushback}` : null,
    shape.stance ? `stance=${shape.stance}` : null,
    shape.nameUse ? `names=${shape.nameUse}` : null,
    shape.react ? 'opens-on-a-reaction' : null,
    shape.renamed ? 'ASKED AGAIN (had a name in it)' : null,
    shape.repeated ? 'ASKED AGAIN (was sending the same thing twice)' : null,
  ].filter(Boolean);
  return parts.length ? `   [${parts.join(' · ')}]` : '';
}

/** `3` for the third line of the round, so a reply can point at one. */
function numbering(room: Room) {
  const order = new Map<string, number>();
  roundAnswers(room).forEach((answer, index) => order.set(answer.id, index + 1));
  return order;
}

export function useRoundLog(room: Room | null) {
  // Where the printing has got to. Kept per match, and reset when the room
  // goes away, so leaving and finding another game starts a fresh log.
  const printed = useRef(0);
  const round = useRef(0);
  const id = useRef<string | null>(null);

  useEffect(() => {
    if (!__DEV__) return;

    if (!room) {
      printed.current = 0;
      round.current = 0;
      id.current = null;
      return;
    }

    if (room.id !== id.current) {
      id.current = room.id;
      printed.current = 0;
      round.current = 0;
      const seats = room.players
        .map((p) => `${p.name}${p.id === room.impostorId ? ' (impostor)' : ''}${p.isYou ? ' (you)' : ''}`)
        .join(', ');
      print(`╔══ match ${room.id} ══`);
      print(`║ ${seats}`);
    }

    if (room.round !== round.current) {
      round.current = room.round;
      printed.current = 0;
      print(`╠══ round ${room.round} · ${room.prompt}`);
    }

    const lines = roundAnswers(room);
    if (lines.length < printed.current) printed.current = 0;

    const order = numbering(room);

    for (const answer of lines.slice(printed.current)) {
      const who = playerById(room, answer.playerId);
      const seat = (who?.name ?? 'someone').padEnd(8);
      const mark = answer.playerId === room.impostorId ? '*' : ' ';
      const at = answer.replyToId ? ` ->${order.get(answer.replyToId) ?? '?'}` : '';
      const n = String(order.get(answer.id) ?? '?').padStart(2);

      if (answer.kind === 'departure') {
        print(`║ ${n}   ${seat} left the room`);
        continue;
      }

      if (answer.timedOut) {
        print(`║ ${n} ${mark} ${seat} (ran out of time)`);
        continue;
      }

      const isImpostor = answer.playerId === room.impostorId;
      const drawn = isImpostor ? (shapes.get(answer.text.trim()) ?? null) : null;

      /*
       * A stock line says so, loudly. Everything else in this log is a note
       * about what the model did; this is the one that says it did nothing.
       */
      const fellBack = isImpostor ? (fallbacks.get(answer.text.trim()) ?? null) : null;
      const note = fellBack ? `   [STOCK — ${fellBack}]` : shapeNote(drawn);

      print(`║ ${n} ${mark} ${seat}${at.padEnd(5)} ${answer.text}${note}`);
    }

    printed.current = lines.length;
  }, [room]);

  // The ballot, once it is closed and there is something to say about it.
  const closed = room?.ballotClosed ?? false;
  useEffect(() => {
    if (!__DEV__ || !room || !closed) return;

    const votes = Object.entries(room.votes)
      .map(([voter, target]) => {
        const from = playerById(room, voter)?.name ?? voter;
        const to = target ? (playerById(room, target)?.name ?? target) : 'nobody';
        return `${from}->${to}`;
      })
      .join('  ');

    const result = voteResult(room);
    const outcome =
      result.kind === 'eliminated'
        ? `out: ${playerById(room, result.playerId)?.name}`
        : result.kind === 'tied'
          ? `tied: ${result.playerIds.map((p) => playerById(room, p)?.name).join(' / ')}`
          : 'nobody';

    print(`║ vote  ${votes}   =>  ${outcome}`);
    if (voteFallback) print(`║       impostor voted at random — ${voteFallback}`);
    // The impostor's seat is the only thing here nobody in the room knows.
    print(`║       impostor is ${playerById(room, room.impostorId)?.name}`);
  }, [closed, room]);
}
