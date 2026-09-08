/**
 * Stands in for people walking out. Until there is a server telling the room
 * who dropped, a stranger leaves on a roll here, so the shell can actually be
 * played against the thing that will happen constantly in a room of strangers.
 *
 * The impostor never leaves — a model has nowhere to go — and that is a real
 * tell, not an oversight of the mock.
 */

import { useEffect, useRef } from 'react';

import { survivors, type Room } from './types';

/**
 * How often somebody walks out over the course of one round.
 *
 * Per round rather than per turn, because a round is not a fixed number of
 * turns: it is players times `turnsEach`, and it shrinks as the room does.
 * A per-turn chance quietly triples when the round length dial moves, which
 * is how a room of seven ends up empty by round three.
 *
 * Off, deliberately. It was 0.5, and half the rounds losing a seat is
 * probably honest about a room of strangers — but a player disappearing
 * mid-round takes the conversation with them, and the thing being read right
 * now is what the impostor does in a conversation. A round that ends up
 * three-handed because somebody rolled badly is a round that says nothing
 * about that.
 *
 * Everything else here is left standing: the reducer still handles a
 * departure, the room still renders one, and the impostor is still told who
 * is left. Only the roll is gone, so putting it back is this number.
 */
const DROPOUT_CHANCE_PER_ROUND = 0;

/** They go mid-turn rather than neatly between them, as people actually do. */
const MIN_LEAVE_MS = 800;
const MAX_LEAVE_MS = 6000;

export function useDropouts(room: Room | null, playerLeft: (playerId: string) => void) {
  const leftRef = useRef(playerLeft);
  leftRef.current = playerLeft;

  // Read at fire time so the timer stays keyed to the turn rather than
  // restarting every time an answer lands.
  const roomRef = useRef<Room | null>(room);
  roomRef.current = room;

  const phase = room?.phase;
  const round = room?.round;
  const turnIndex = room?.turnIndex;
  const turnsThisRound = room?.turnOrder.length ?? 0;

  useEffect(() => {
    if (phase !== 'answering' || turnsThisRound === 0) return;
    if (DROPOUT_CHANCE_PER_ROUND <= 0) return;
    // Spread the round's chance evenly across the turns it actually has.
    const perTurn = 1 - Math.pow(1 - DROPOUT_CHANCE_PER_ROUND, 1 / turnsThisRound);
    if (Math.random() > perTurn) return;

    const wait = MIN_LEAVE_MS + Math.random() * (MAX_LEAVE_MS - MIN_LEAVE_MS);
    const timer = setTimeout(() => {
      const current = roomRef.current;
      if (!current) return;

      const canLeave = survivors(current).filter(
        (p) => p.id !== current.youId && p.id !== current.impostorId
      );
      // Leave the room with somebody to play against.
      if (canLeave.length <= 1) return;

      leftRef.current(canLeave[Math.floor(Math.random() * canLeave.length)].id);
    }, wait);

    return () => clearTimeout(timer);
    // round + turnIndex identify the turn, so each one is rolled for once.
  }, [phase, round, turnIndex, turnsThisRound]);
}
