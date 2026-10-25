/**
 * What a change in the room means for analytics. Kept apart from the hook that
 * sends it so it can be played against the real reducer in tests.
 *
 * - `match_started`: you were seated in a room.
 * - `vote_cast`: you locked in a vote, once per ballot (a tiebreaker is its own).
 * - `match_ended`: the match was decided — whether the impostor was caught.
 * - `match_abandoned`: the room went away before it was decided.
 */

import { playerById, type Room } from './types';

export type MatchEvent = {
  name: 'match_started' | 'vote_cast' | 'match_ended' | 'match_abandoned';
  params: Record<string, string | number>;
};

/**
 * The events between two rooms the player has seen in a row. `loggedBallots`
 * is carried between calls, so a ballot counts once however often the room is
 * re-sent while it is open.
 */
export function matchEvents(
  before: Room | null,
  room: Room | null,
  loggedBallots: Set<string>,
  online: boolean
): MatchEvent[] {
  const events: MatchEvent[] = [];

  if (before && before.id !== room?.id && !before.outcome) {
    events.push({
      name: 'match_abandoned',
      params: {
        room_size: before.settings.playerCount,
        round: before.round,
        you_were_out: yesNo(playerById(before, before.youId)?.eliminated),
      },
    });
  }

  if (!room) return events;

  const isNewRoom = room.id !== before?.id;
  if (isNewRoom) loggedBallots.clear();

  // Only a room nobody has spoken in yet. Reopening the app mid-match gets
  // the room sent again, and that is the same match, not a new one.
  if (isNewRoom && room.transcript.length === 0) {
    events.push({
      name: 'match_started',
      params: { room_size: room.settings.playerCount, online: yesNo(online) },
    });
  }

  // Only while the ballot is open. Closing it adds to `ballots` with you
  // still in `voted`, and a ballot that runs out of time puts everyone in
  // `voted` — neither is you voting. A tiebreaker is a second ballot in the
  // same round, hence the count.
  const ballotOpen = room.phase === 'voting' && !room.ballotClosed;
  const ballot = `${room.round}:${room.ballots.length}`;
  if (ballotOpen && room.voted.includes(room.youId) && !loggedBallots.has(ballot)) {
    loggedBallots.add(ballot);
    events.push({
      name: 'vote_cast',
      params: {
        round: room.round,
        abstained: yesNo(!room.votes[room.youId]),
        tiebreaker: yesNo(room.tiebreaker !== null),
      },
    });
  }

  // Only a match seen running. Reopening the app onto one that is already
  // decided would otherwise count it a second time.
  if (room.outcome && before?.id === room.id && !before.outcome) {
    events.push({
      name: 'match_ended',
      params: {
        room_size: room.settings.playerCount,
        rounds: room.round,
        impostor_caught: yesNo(room.outcome === 'humans'),
        you_survived: yesNo(!playerById(room, room.youId)?.eliminated),
      },
    });
  }

  return events;
}

/** Analytics params want strings or numbers; these read better in reports. */
function yesNo(value: boolean | undefined) {
  return value ? 'yes' : 'no';
}
