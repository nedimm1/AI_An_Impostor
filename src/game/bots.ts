/**
 * Drives the stand-in players' turns. Until there is a server (and a model
 * writing the impostor's answers), a stranger's turn resolves on a timer here
 * so the round can actually advance on one device.
 */

import { useEffect, useRef } from 'react';

import { mockAnswer } from './mock';
import { currentTurnId, YOU_ID, type Room } from './types';

/** How long a stand-in "thinks" before their answer lands. */
const MIN_THINK_MS = 1400;
const MAX_THINK_MS = 4600;

export function useBotTurns(
  room: Room | null,
  answerTurn: (text: string, timedOut: boolean) => void
) {
  const answerRef = useRef(answerTurn);
  answerRef.current = answerTurn;

  const phase = room?.phase;
  const round = room?.round;
  const turnIndex = room?.turnIndex;
  const turnId = room ? currentTurnId(room) : null;
  const isStrangersTurn = turnId !== null && turnId !== YOU_ID;

  useEffect(() => {
    if (phase !== 'answering' || !isStrangersTurn) return;

    const think = MIN_THINK_MS + Math.random() * (MAX_THINK_MS - MIN_THINK_MS);
    const timer = setTimeout(() => answerRef.current(mockAnswer(), false), think);
    return () => clearTimeout(timer);
    // round + turnIndex identify the turn, so each one is scheduled exactly once.
  }, [phase, isStrangersTurn, turnId, round, turnIndex]);
}
