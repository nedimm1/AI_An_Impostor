/**
 * Drives the stand-in players' turns. Until there is a server (and a model
 * writing the impostor's answers), a stranger's turn resolves on a timer here
 * so the round can actually advance on one device.
 */

import { useEffect, useRef } from 'react';

import { mockAnswer } from './mock';
import { currentTurnId, survivors, YOU_ID, type Answer, type Room } from './types';

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


/**
 * How long the stand-ins take to lock in. Spread across most of the ballot so
 * the room fills up a name at a time rather than all at once — waiting on the
 * last holdout is the point of the vote.
 */
const MIN_VOTE_MS = 18000;
const MAX_VOTE_MS = 28000;

/**
 * The other players' votes. Each lands on its own timer, so the ballot fills
 * while you watch it, and the last one in is what closes the room.
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

  useEffect(() => {
    if (!voting) return;
    const opened = roomRef.current;
    if (!opened) return;

    const timers = survivors(opened)
      .filter((p) => !p.isYou)
      .map((voter) => {
        const wait = MIN_VOTE_MS + Math.random() * (MAX_VOTE_MS - MIN_VOTE_MS);
        return setTimeout(() => {
          const now = roomRef.current;
          if (!now || now.phase !== 'voting' || now.ballotClosed) return;

          // Read the room at fire time — somebody may have walked out since.
          const options = survivors(now).filter((t) => t.id !== voter.id);
          if (options.length === 0) return;

          castRef.current(voter.id, options[Math.floor(Math.random() * options.length)].id);
        }, wait);
      });

    return () => timers.forEach(clearTimeout);
    // One ballot per round, plus one more if the round goes to a tiebreaker.
  }, [voting, id, round, inTiebreaker]);
}
