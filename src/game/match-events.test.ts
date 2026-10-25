/**
 * The analytics events, played against the real reducer. Each test walks a
 * match one action at a time and feeds every room the player would have seen
 * to `matchEvents`, the way the hook does.
 */

import { viewFor } from '../../server/game/view';
import { matchEvents, type MatchEvent } from './match-events';
import { roomReducer, type MatchAction } from './reducer';
import { survivors, type Player, type Room } from './types';

const YOUR_ID = 'you-uuid';
/** With Math.random pinned to 0, the first stranger is the impostor. */
const IMPOSTOR = 'p_mara';

function strangers(...names: string[]): Player[] {
  return names.map((name) => ({
    id: `p_${name.toLowerCase()}`,
    name: '',
    tint: '',
    isYou: false,
    connected: true,
    eliminated: false,
  }));
}

/**
 * Plays a match and records the events. `see` turns each room into what the
 * phone is shown: as-is on one device, or through the server's view online.
 */
function session(see: (room: Room | null) => Room | null = (r) => r) {
  let state: Room | null = null;
  let shown: Room | null = null;
  const logged = new Set<string>();
  const events: MatchEvent[] = [];

  const show = (next: Room | null) => {
    const seen = see(next);
    events.push(...matchEvents(shown, seen, logged, false));
    shown = seen;
  };

  return {
    events,
    get room() {
      if (!state) throw new Error('expected a room');
      return state;
    },
    act(action: MatchAction) {
      const real = Math.random;
      Math.random = () => 0;
      try {
        state = roomReducer(state, action);
      } finally {
        Math.random = real;
      }
      show(state);
    },
    /** The phone's view arriving again with nothing changed, as a re-send does. */
    resend() {
      show(state);
    },
    /** The app closed and reopened: nothing seen before the next room. */
    relaunch() {
      shown = null;
      logged.clear();
    },
  };
}

function start(s: ReturnType<typeof session>) {
  s.act({
    type: 'startMatch',
    id: 'rm_test',
    yourId: YOUR_ID,
    strangers: strangers('Mara', 'Deniz', 'Kofi', 'Ines'),
  });
}

function answerOut(s: ReturnType<typeof session>) {
  while (s.room.phase === 'answering') {
    s.act({ type: 'answerTurn', text: 'something', timedOut: false, replyToId: null });
  }
}

function vote(s: ReturnType<typeof session>, voterId: string, targetId: string | null) {
  s.act({ type: 'castVote', voterId, targetId });
}

function othersVote(s: ReturnType<typeof session>, targetId: string) {
  for (const p of survivors(s.room)) {
    if (p.id !== YOUR_ID) vote(s, p.id, targetId);
  }
}

const names = (events: MatchEvent[]) => events.map((e) => e.name);

describe('match analytics', () => {
  it('logs a whole match the room wins once each, on one device and online', () => {
    const online = (r: Room | null) =>
      r && viewFor(r, YOUR_ID, false);

    for (const see of [undefined, online]) {
      const s = session(see);
      start(s);
      answerOut(s);
      vote(s, YOUR_ID, IMPOSTOR);
      s.resend();
      othersVote(s, IMPOSTOR);
      s.resend();

      expect(names(s.events)).toEqual(['match_started', 'vote_cast', 'match_ended']);
      expect(s.events[1].params).toMatchObject({ round: 1, abstained: 'no', tiebreaker: 'no' });
      expect(s.events[2].params).toMatchObject({
        room_size: 5,
        rounds: 1,
        impostor_caught: 'yes',
        you_survived: 'yes',
      });
    }
  });

  it('counts abstaining as a vote, and a ballot that runs out of time as none', () => {
    const s = session();
    start(s);
    answerOut(s);
    vote(s, YOUR_ID, null);
    expect(s.events.at(-1)).toMatchObject({ name: 'vote_cast', params: { abstained: 'yes' } });

    s.act({ type: 'closeBallot' });
    s.act({ type: 'nextRound' });
    answerOut(s);
    s.act({ type: 'closeBallot' });

    expect(names(s.events).filter((n) => n === 'vote_cast')).toHaveLength(1);
  });

  it('counts a tiebreaker as its own ballot', () => {
    const s = session();
    start(s);
    answerOut(s);
    // Two each on Kofi and Ines, one abstaining.
    vote(s, YOUR_ID, 'p_kofi');
    vote(s, 'p_mara', 'p_kofi');
    vote(s, 'p_deniz', 'p_ines');
    vote(s, 'p_kofi', 'p_ines');
    vote(s, 'p_ines', null);
    expect(s.room.pendingTiebreaker).not.toBeNull();

    s.act({ type: 'nextRound' });
    answerOut(s);
    vote(s, YOUR_ID, 'p_kofi');

    const votes = s.events.filter((e) => e.name === 'vote_cast');
    expect(votes.map((e) => e.params.tiebreaker)).toEqual(['no', 'yes']);
  });

  it('logs the impostor getting away', () => {
    const s = session();
    start(s);
    for (let round = 0; !s.room.outcome; round++) {
      answerOut(s);
      // Everyone piles on a human, so the room whittles itself down.
      const human = survivors(s.room).find((p) => p.id !== IMPOSTOR && p.id !== YOUR_ID);
      vote(s, YOUR_ID, human!.id);
      othersVote(s, human!.id);
      if (!s.room.outcome) s.act({ type: 'nextRound' });
    }
    expect(s.events.at(-1)).toMatchObject({
      name: 'match_ended',
      params: { impostor_caught: 'no' },
    });
  });

  it('does not count a match again when the app reopens into it', () => {
    const s = session();
    start(s);
    answerOut(s);

    s.relaunch();
    s.resend();
    expect(names(s.events)).toEqual(['match_started']);

    vote(s, YOUR_ID, IMPOSTOR);
    othersVote(s, IMPOSTOR);
    s.relaunch();
    s.resend();
    expect(names(s.events)).toEqual(['match_started', 'vote_cast', 'match_ended']);
  });

  it('logs walking out of an undecided match, and not leaving a decided one', () => {
    const s = session();
    start(s);
    answerOut(s);
    s.act({ type: 'leaveRoom' });
    expect(s.events.at(-1)).toMatchObject({
      name: 'match_abandoned',
      params: { round: 1, you_were_out: 'no' },
    });

    const t = session();
    start(t);
    answerOut(t);
    vote(t, YOUR_ID, IMPOSTOR);
    othersVote(t, IMPOSTOR);
    t.act({ type: 'leaveRoom' });
    expect(names(t.events)).not.toContain('match_abandoned');
  });
});
