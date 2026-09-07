/**
 * The match, run on this device.
 *
 * This is the stand-in for a server: it owns the rules (`reducer.ts`), it
 * plays the other six people, and it holds every clock that is not yours. The
 * screens can see what it produces and send it intents, and that is all — the
 * same deal they would get from a socket.
 *
 * Everything fake in here is fake in one place. Replacing it with a real
 * backend means writing another `MatchTransport` and changing which one
 * `store.tsx` builds; no screen and no rule has to move.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { useResumeSignal } from '@/hooks/use-app-state';

import { useBotTurns, useStrangerVotes } from './bots';
import { useDropouts } from './dropouts';
import { useMatchmaking, type Match } from './matchmaking';
import { useRoundLog } from './round-log';
import type { Profile } from './profile';
import { roomReducer, type MatchAction } from './reducer';
import { TEST_MODE } from './testing';
import type { Intent, MatchTransport } from './transport';
import { DEFAULT_SETTINGS, type Room } from './types';

/**
 * How long past a deadline the room waits before enforcing it. Your own clock
 * runs out on your device a moment before the room's does, so the answer or
 * vote you were still holding gets in ahead of the room giving up on you.
 */
const EXPIRY_GRACE_MS = 300;

/** Milliseconds until `deadline`, never negative. */
function until(deadline: number) {
  return Math.max(0, deadline - Date.now() + EXPIRY_GRACE_MS);
}

export function useLocalTransport(profile: Profile | null): MatchTransport {
  const [room, dispatch] = useReducer(roomReducer, null);

  // Coming back from the background re-runs every clock below. A deadline that
  // has already passed is then enforced at once — `until` floors at zero — so
  // a room recovers whether or not its timers survived being away.
  const resumedAt = useResumeSignal();

  // Read at fire time rather than captured, so a timer stays keyed to the
  // deadline it is enforcing instead of restarting on every state change.
  const roomRef = useRef<Room | null>(room);
  roomRef.current = room;
  const profileRef = useRef<Profile | null>(profile);
  profileRef.current = profile;

  const searchingRef = useRef(false);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  const onMatched = useCallback(({ id, strangers }: Match) => {
    const current = profileRef.current;
    if (!current) return;
    searchingRef.current = false;
    dispatch({
      type: 'startMatch',
      id,
      yourId: current.playerId,
      yourName: current.displayName,
      strangers,
    });
  }, []);

  const matchmaking = useMatchmaking(
    DEFAULT_SETTINGS.playerCount,
    searchingRef.current && room === null,
    onMatched
  );

  const findMatch = useCallback(() => {
    searchingRef.current = true;
    forceRender();
  }, []);

  // --- The other six players -------------------------------------------
  const answerTurn = useCallback(
    (text: string, timedOut: boolean, replyToId: string | null = null) =>
      dispatch({ type: 'answerTurn', text, timedOut, replyToId }),
    []
  );
  const castVote = useCallback(
    (voterId: string, targetId: string | null) =>
      dispatch({ type: 'castVote', voterId, targetId }),
    []
  );
  const playerLeft = useCallback(
    (playerId: string) => dispatch({ type: 'playerLeft', playerId }),
    []
  );

  useBotTurns(room, answerTurn);
  useStrangerVotes(room, castVote);
  useDropouts(room, playerLeft);

  // Prints the round as it happens, in development only. Reads the room and
  // changes nothing about it.
  useRoundLog(room);

  // --- The room's clocks ------------------------------------------------
  // A turn that expires still costs the turn. The screen submits whatever is
  // in the box on its own clock, a moment before this one; this is what
  // happens to any seat it did not hear from, yours and the ones you are
  // typing alike.
  //
  // The clock used to be off under test, on the grounds that six seats at
  // forty seconds is a typing exercise rather than a test. It is back on
  // because the impostor's turn is timed too, and a harness that reads what
  // the model writes while quietly removing the deadline it wrote against is
  // not reading the same player the room will meet.
  const turnEndsAt = room?.phase === 'answering' ? room.turnEndsAt : null;
  useEffect(() => {
    if (turnEndsAt === null) return;
    const timer = setTimeout(
      () => dispatch({ type: 'answerTurn', text: '', timedOut: true, replyToId: null }),
      until(turnEndsAt)
    );
    return () => clearTimeout(timer);
  }, [turnEndsAt, resumedAt]);

  // Nobody's phone-down holds the room up: the ballot closes on its own and
  // everyone it did not hear from is counted as having named nobody.
  const voteEndsAt = room?.phase === 'voting' && !room.ballotClosed ? room.voteEndsAt : null;
  useEffect(() => {
    if (voteEndsAt === null) return;
    const timer = setTimeout(() => dispatch({ type: 'closeBallot' }), until(voteEndsAt));
    return () => clearTimeout(timer);
  }, [voteEndsAt, resumedAt]);

  // A round result is a beat, not a decision — it runs out and the room goes
  // again. Being voted out is the exception: watching on or walking away is a
  // choice only you can make, so that one waits on you.
  const youWereVotedOut = room != null && room.eliminatedId === room.youId;
  const verdictEndsAt =
    room?.phase === 'verdict' && !(youWereVotedOut && !room.spectating)
      ? room.verdictEndsAt
      : null;
  useEffect(() => {
    if (verdictEndsAt === null) return;
    const timer = setTimeout(() => dispatch({ type: 'nextRound' }), until(verdictEndsAt));
    return () => clearTimeout(timer);
  }, [verdictEndsAt, resumedAt]);

  // --- What you do ------------------------------------------------------
  const send = useCallback((intent: Intent) => {
    const current = roomRef.current;
    if (!current) return;

    // Somebody else's turn, typed by you. The reducer has no idea a seat
    // changed hands — it answers whoever's turn it currently is, which is
    // exactly the seat the screen was showing you.
    if (intent.type === 'answerAs') {
      if (!TEST_MODE) return;
      if (current.turnOrder[current.turnIndex] !== intent.playerId) return;
      dispatch({
        type: 'answerTurn',
        text: intent.text,
        timedOut: false,
        replyToId: intent.replyToId,
      });
      return;
    }

    const action: MatchAction | null =
      intent.type === 'answer'
        ? {
            type: 'answerTurn',
            text: intent.text,
            timedOut: intent.timedOut,
            replyToId: intent.replyToId,
          }
        : intent.type === 'vote'
          ? { type: 'castVote', voterId: current.youId, targetId: intent.targetId }
          : intent.type === 'spectate'
            ? { type: 'spectate' }
            : { type: 'leaveRoom' };

    // Speaking out of turn is not a thing you can do, whoever asks.
    if (action.type === 'answerTurn' && current.turnOrder[current.turnIndex] !== current.youId) {
      return;
    }
    dispatch(action);
  }, []);

  // Your name follows you into a room you are already sitting in.
  const displayName = profile?.displayName;
  useEffect(() => {
    if (displayName === undefined) return;
    dispatch({ type: 'rename', name: displayName });
  }, [displayName]);

  return useMemo(
    () => ({ room, matchmaking, findMatch, send }),
    [room, matchmaking, findMatch, send]
  );
}
