/**
 * Drives the stand-in players' turns. Until there is a server (and a model
 * writing the impostor's answers), a stranger's turn resolves on a timer here
 * so the round can actually advance on one device.
 *
 * What they say comes from `mock.ts`; how they behave comes from
 * `humanlike.ts`. One seat is different: when a proxy is configured, the
 * player the room is actually hunting gets its line from a model instead of
 * from the stock list, and is otherwise driven by exactly the same clock as
 * everybody else. That last part is the point — an impostor that writes
 * beautifully but answers on a different distribution to the room is findable
 * without reading a word of it.
 */

import { useEffect, useRef } from 'react';

import {
  answerDelay,
  answerDelayWithin,
  missesTurn,
  pickReplyTarget,
  voteDelay,
} from './humanlike';
import { impostorEnabled, requestImpostorAnswer, requestImpostorVote } from './impostor';
import { mockAnswer } from './mock';
import { TEST_MODE } from './testing';
import { currentTurnId, roundAnswers, survivors, type Answer, type Room } from './types';

/**
 * How much of a turn is held back for actually sending the impostor's line.
 *
 * The model used to be given the whole window as its deadline, which cannot
 * work: a call that takes all forty seconds leaves nothing to put the words
 * in, and the stock line that covers for it has nowhere to go either. So the
 * request is cut short of the clock, and whatever comes back — the model's
 * line or the fallback — still has a moment to land inside the turn.
 */
const SEND_MARGIN_MS = 1_500;

export function useBotTurns(
  room: Room | null,
  answerTurn: (text: string, timedOut: boolean, replyToId?: string | null) => void
) {
  const answerRef = useRef(answerTurn);
  answerRef.current = answerTurn;

  // Read at fire time, not capture time, so the timer effect can stay keyed to
  // the turn rather than restarting whenever an answer lands.
  const answersRef = useRef<Answer[]>([]);
  answersRef.current = room ? roundAnswers(room) : [];

  const roomRef = useRef<Room | null>(room);
  roomRef.current = room;

  const phase = room?.phase;
  const round = room?.round;
  const turnIndex = room?.turnIndex;
  const turnId = room ? currentTurnId(room) : null;
  const isStrangersTurn = turnId !== null && turnId !== room?.youId;
  const isImpostorsTurn = turnId !== null && turnId === room?.impostorId;
  const windowMs = (room?.settings.answerSeconds ?? 0) * 1000;

  useEffect(() => {
    if (phase !== 'answering' || !isStrangersTurn || windowMs <= 0) return;

    const openedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    // Who this turn is aimed at, decided now rather than at send time. It used
    // to be drawn after the words came back, which meant the impostor's line
    // was pinned under a message it had never been shown — the room rendered a
    // reply that answered nothing. Everyone else gets the same fix for free:
    // a stock line is no more of a reply than the model's was.
    // Whose turn it is, not whose device this is: everybody replies from
    // their own seat, and the seat is what decides whether the last message
    // was aimed at them.
    const replyToId = pickReplyTarget(answersRef.current, turnId);

    /**
     * How long they take depends on how much they wrote, so nothing can be
     * scheduled until the words exist. For the impostor the words arrive a
     * second or two into its own turn, and that time is spent, not added —
     * the delay is still measured from when the turn opened, so a model that
     * happens to be slow eats its own thinking time rather than pushing the
     * whole room later.
     */
    const scheduleSend = (text: string, canMiss = true) => {
      const delay = canMiss
        ? answerDelay(text, windowMs)
        : answerDelayWithin(text, windowMs);

      // Somebody who runs past their clock simply never sends. The room's own
      // turn expiry picks it up and they are shown as having run out of time,
      // exactly as if a person had put their phone down mid-sentence.
      if (canMiss && missesTurn(delay, windowMs)) return;

      timer = setTimeout(
        () => answerRef.current(text, false, replyToId),
        Math.max(0, delay - (Date.now() - openedAt))
      );
    };

    if (!isImpostorsTurn || !impostorEnabled()) {
      // Under test the stand-ins have nothing to say: their turn sits open
      // until it is typed for them. Only the impostor still answers itself,
      // which is the whole arrangement being tested.
      if (TEST_MODE) return;
      scheduleSend(mockAnswer());
    } else {
      const opened = roomRef.current;
      if (!opened) return;

      // The clock is already running while this is in flight, which is why the
      // deadline is the turn less the margin: a line that lands after the turn
      // has gone is not late, it is nothing.
      const deadline = Math.max(1_000, windowMs - SEND_MARGIN_MS);

      requestImpostorAnswer(opened, deadline, replyToId).then((text) => {
        if (cancelled) return;
        // Null covers every failure — proxy down, model refused, empty
        // completion, too slow. A stock line is a worse impostor than a model
        // and a far better one than a blank message, and the room must never
        // be able to tell that the server fell over.
        //
        // Under test it is also the only player answering itself, so it does
        // not get to draw a turn it sits out: the clock is on to see whether
        // the model comes back in time, not to watch it roll a miss.
        scheduleSend(text ?? mockAnswer(), !TEST_MODE);
      });
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // round + turnIndex identify the turn, so each one is scheduled exactly once.
  }, [phase, isStrangersTurn, isImpostorsTurn, turnId, round, turnIndex, windowMs]);
}


/**
 * The other players' votes. Each lands on its own timer, so the ballot fills
 * while you watch it, and the last one in is what closes the room.
 *
 * The stand-ins vote at random, which is honest: they are not playing, and a
 * room of stand-ins with opinions would be a room this file was pretending to
 * simulate. The impostor is the exception. Its vote is a quarter of a
 * five-player ballot and it is the one seat with something at stake, so a
 * random one throws away rounds it should have survived — and, worse, spends
 * them removing the players who were covering for it.
 */
export function useStrangerVotes(
  room: Room | null,
  castVote: (voterId: string, targetId: string | null) => void
) {
  const castRef = useRef(castVote);
  castRef.current = castVote;

  const roomRef = useRef<Room | null>(room);
  roomRef.current = room;

  const voting = room?.phase === 'voting';
  const id = room?.id;
  const round = room?.round;
  const inTiebreaker = room?.tiebreaker != null;
  const windowMs = (room?.settings.voteSeconds ?? 0) * 1000;

  useEffect(() => {
    if (!voting) return;
    const opened = roomRef.current;
    if (!opened) return;

    const timers = survivors(opened)
      .filter((p) => !p.isYou)
      .map((voter) => {
        const wait = voteDelay(windowMs);
        // Somebody who sits past the ballot never locks in. The room closes on
        // its own clock and counts them as having named nobody, which is a
        // thing people do and a thing a room of five certain voters is not.
        // The impostor gets the same draw, and a missed one costs no call.
        if (missesTurn(wait, windowMs)) return null;

        // Asked as the ballot opens and read when this seat locks in, so the
        // thinking happens inside the wait rather than on top of it. Whoever
        // it names is checked against the room again at fire time.
        let picked: string | null = null;
        if (voter.id === opened.impostorId && impostorEnabled()) {
          requestImpostorVote(opened, windowMs).then((id) => {
            picked = id;
          });
        }

        return setTimeout(() => {
          const now = roomRef.current;
          if (!now || now.phase !== 'voting' || now.ballotClosed) return;

          // Read the room at fire time — somebody may have walked out since.
          const options = survivors(now).filter((t) => t.id !== voter.id);
          if (options.length === 0) return;

          // A name that has left the room since it was chosen is no longer a
          // vote. Failing back to random is not a worse impostor than the one
          // that voted at random all along.
          const chosen = options.some((o) => o.id === picked)
            ? picked!
            : options[Math.floor(Math.random() * options.length)].id;

          castRef.current(voter.id, chosen);
        }, wait);
      });

    return () => timers.forEach((timer) => timer && clearTimeout(timer));
    // One ballot per round, plus one more if the round goes to a tiebreaker.
  }, [voting, id, round, inTiebreaker, windowMs]);
}
