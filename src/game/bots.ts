/**
 * Drives the stand-in players' turns. Until there is a server (and a model
 * writing the impostor's answers), a stranger's turn resolves on a timer here
 * so the round can actually advance on one device.
 */

import { useEffect, useRef } from 'react';

import { mockAnswer } from './mock';
import { currentTurnId, YOU_ID, type Answer, type Room } from './types';

/** How long a stand-in "thinks" before their answer lands. */
const MIN_THINK_MS = 1400;
const MAX_THINK_MS = 4600;

/**
 * How often a stand-in writes back at something already said rather than
 * answering the prompt cold. Kept low — a room where everyone quotes everyone
 * reads as noise.
 */
const REPLY_CHANCE = 0.35;

/** Something recent to write back at, or null to just answer the prompt. */
function pickReplyTarget(answers: Answer[]) {
  if (Math.random() > REPLY_CHANCE) return null;
  const recent = answers.filter((a) => !a.timedOut).slice(-3);
  if (recent.length === 0) return null;
  return recent[Math.floor(Math.random() * recent.length)].id;
}

export function useBotTurns(
  room: Room | null,
  answerTurn: (text: string, timedOut: boolean, replyToId?: string | null) => void
) {
  const answerRef = useRef(answerTurn);
  answerRef.current = answerTurn;

  // Read at fire time, not capture time, so the timer effect can stay keyed to
  // the turn rather than restarting whenever an answer lands.
  const answersRef = useRef<Answer[]>([]);
  answersRef.current = room?.answers ?? [];

  const phase = room?.phase;
  const round = room?.round;
  const turnIndex = room?.turnIndex;
  const turnId = room ? currentTurnId(room) : null;
  const isStrangersTurn = turnId !== null && turnId !== YOU_ID;

  useEffect(() => {
    if (phase !== 'answering' || !isStrangersTurn) return;

    const think = MIN_THINK_MS + Math.random() * (MAX_THINK_MS - MIN_THINK_MS);
    const timer = setTimeout(
      () => answerRef.current(mockAnswer(), false, pickReplyTarget(answersRef.current)),
      think
    );
    return () => clearTimeout(timer);
    // round + turnIndex identify the turn, so each one is scheduled exactly once.
  }, [phase, isStrangersTurn, turnId, round, turnIndex]);
}
