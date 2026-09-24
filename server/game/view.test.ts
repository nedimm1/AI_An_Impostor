/**
 * What a phone can learn from the raw messages, checked the way a curious
 * player would check it: by reading the whole thing, not just the fields a
 * screen happens to draw.
 */

import { roomReducer, type MatchAction } from '../rules/reducer';
import { currentTurnId, survivors, type Player, type Room } from '../rules/types';

import { Match, type ImpostorModel } from './match';
import { viewFor } from './view';

const seat = (id: string): Player => ({
  id,
  name: '',
  tint: '',
  isYou: false,
  connected: true,
  eliminated: false,
});

function play(room: Room | null, ...actions: MatchAction[]): Room {
  const next = actions.reduce(roomReducer, room);
  if (!next) throw new Error('room went away');
  return next;
}

/** A seated room where `p_me` is a person and the other four are not. */
function seated(): Room {
  return play(null, {
    type: 'startMatch',
    id: 'rm_view',
    yourId: 'p_me',
    strangers: ['p_a', 'p_b', 'p_c', 'p_d'].map(seat),
    humanIds: ['p_me'],
  });
}

function toBallot(room: Room): Room {
  let r = room;
  while (r.phase === 'answering') {
    r = play(r, { type: 'answerTurn', text: 'something', timedOut: false, replyToId: null });
  }
  return r;
}

describe('what a phone is sent', () => {
  it('does not say who the impostor is while the match is running', () => {
    const r = seated();
    expect(r.impostorId).not.toBeNull();
    expect(viewFor(r, 'p_me', false).impostorId).toBeNull();
    // Not in some other field either — the id appears only as a seat.
    const raw = JSON.stringify(viewFor(r, 'p_me', false));
    expect(raw).not.toContain('"impostorId":"');
  });

  it('reveals the impostor once the match is decided', () => {
    const voting = toBallot(seated());
    const impostor = voting.impostorId!;
    const voters = survivors(voting).filter((p) => p.id !== impostor);
    const decided = play(
      voting,
      ...voters.map((v) => ({ type: 'castVote' as const, voterId: v.id, targetId: impostor })),
      { type: 'closeBallot' }
    );
    expect(decided.outcome).toBe('humans');
    expect(viewFor(decided, 'p_me', false).impostorId).toBe(impostor);
  });

  it('keeps other people’s votes back while the ballot is open', () => {
    const voting = play(
      toBallot(seated()),
      { type: 'castVote', voterId: 'p_me', targetId: 'p_a' },
      { type: 'castVote', voterId: 'p_b', targetId: 'p_me' }
    );
    expect(voting.ballotClosed).toBe(false);

    const mine = viewFor(voting, 'p_me', false);
    // Your own vote, because your screen shows what you locked in…
    expect(mine.votes).toEqual({ p_me: 'p_a' });
    // …and who has locked in, because the room shows that too — but not for whom.
    expect(mine.voted).toEqual(expect.arrayContaining(['p_me', 'p_b']));

    expect(viewFor(voting, 'p_c', false).votes).toEqual({});
  });

  it('shows every vote once the ballot has closed', () => {
    const closed = play(
      toBallot(seated()),
      { type: 'castVote', voterId: 'p_me', targetId: 'p_a' },
      { type: 'castVote', voterId: 'p_b', targetId: 'p_me' },
      { type: 'closeBallot' }
    );
    expect(viewFor(closed, 'p_c', false).votes).toEqual({ p_me: 'p_a', p_b: 'p_me' });
  });

  it('does not send the questions still to come', () => {
    const r = seated();
    expect(r.prompts.length).toBeGreaterThan(1);
    const v = viewFor(r, 'p_me', false);
    expect(v.prompts).toEqual([]);
    expect(v.prompt).toBe(r.prompt);
  });

  it('marks only the viewer’s own seat as theirs', () => {
    const v = viewFor(seated(), 'p_b', true);
    expect(v.youId).toBe('p_b');
    expect(v.players.filter((p) => p.isYou).map((p) => p.id)).toEqual(['p_b']);
    expect(v.spectating).toBe(true);
  });
});

describe('seats in an online match', () => {
  const quietModel: ImpostorModel = {
    answer: async () => null,
    vote: async () => null,
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  // Durable ids look like the phone's Crypto.randomUUID().
  const alice = '3f2a91c4-8b1e-4d2a-9c3f-1a2b3c4d5e6f';
  const bob = '7c9d0e1f-2a3b-4c5d-8e9f-0a1b2c3d4e5f';

  const startMatch = () => ({ match: new Match([alice, bob], quietModel, () => {}, () => {}) });

  it('never puts anybody’s durable player id into what is sent', () => {
    const { match } = startMatch();
    for (const who of [alice, bob]) {
      const raw = JSON.stringify(match.view(who));
      expect(raw).not.toContain(alice);
      expect(raw).not.toContain(bob);
    }
    match.leave(alice);
    match.leave(bob);
  });

  it('gives people and the impostor seat ids that look the same', () => {
    // The leak this is here for: people seated under their UUIDs and the model
    // under a short generated id, so the one seat in a different format is the
    // answer to the game.
    const { match } = startMatch();
    const ids = match.view(alice).players.map((p) => p.id);
    const shape = /^p_[a-z0-9]+$/;
    expect(ids.every((id) => shape.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    match.leave(alice);
    match.leave(bob);
  });

  it('lets a person answer only on their own seat’s turn', () => {
    // Seating is random, so draw matches until one opens on a person's turn —
    // a check that quietly skipped itself whenever the draw went the other way
    // would pass without testing anything.
    for (let attempt = 0; attempt < 100; attempt++) {
      const { match } = startMatch();
      const turnSeat = currentTurnId(match.view(alice));
      const onTurn = [alice, bob].find((who) => match.view(who).youId === turnSeat);

      if (onTurn) {
        const offTurn = onTurn === alice ? bob : alice;

        match.handle(offTurn, { type: 'answer', text: 'not my turn', timedOut: false, replyToId: null });
        expect(match.view(alice).transcript).toHaveLength(0);

        match.handle(onTurn, { type: 'answer', text: 'my turn', timedOut: false, replyToId: null });
        expect(match.view(alice).transcript.map((a) => a.text)).toEqual(['my turn']);

        match.leave(alice);
        match.leave(bob);
        return;
      }
      match.leave(alice);
      match.leave(bob);
    }
    throw new Error('no match opened on a person’s turn in 100 draws');
  });
});
