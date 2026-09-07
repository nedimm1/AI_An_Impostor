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

function shapeNote(shape: ImpostorShape | null) {
  if (!shape) return '';
  const parts = [
    shape.pushback ? `pushback=${shape.pushback}` : null,
    shape.stance ? `stance=${shape.stance}` : null,
    shape.nameUse ? `names=${shape.nameUse}` : null,
    shape.react ? 'opens-on-a-reaction' : null,
    shape.renamed ? 'ASKED AGAIN (had a name in it)' : null,
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
      console.log(`╔══ match ${room.id} ══`);
      console.log(`║ ${seats}`);
    }

    if (room.round !== round.current) {
      round.current = room.round;
      printed.current = 0;
      console.log(`╠══ round ${room.round} · ${room.prompt}`);
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
        console.log(`║ ${n}   ${seat} left the room`);
        continue;
      }

      if (answer.timedOut) {
        console.log(`║ ${n} ${mark} ${seat} (ran out of time)`);
        continue;
      }

      const drawn =
        answer.playerId === room.impostorId
          ? (shapes.get(answer.text.trim()) ?? null)
          : null;
      const note = shapeNote(drawn);

      console.log(`║ ${n} ${mark} ${seat}${at.padEnd(5)} ${answer.text}${note}`);
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

    console.log(`║ vote  ${votes}   =>  ${outcome}`);
    // The impostor's seat is the only thing here nobody in the room knows.
    console.log(`║       impostor is ${playerById(room, room.impostorId)?.name}`);
  }, [closed, room]);
}
