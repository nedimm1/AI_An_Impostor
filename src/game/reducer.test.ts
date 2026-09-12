/**
 * The rules, played out. Every test here drives the real reducer through real
 * actions — there is no test-only path into a room, because a room a test can
 * build but the app cannot is not the thing being tested.
 */

import { roomReducer, type MatchAction } from './reducer';
import {
  DEFAULT_SETTINGS,
  playerById,
  roundAnswers,
  survivors,
  voteResult,
  type Player,
  type Room,
} from './types';

const YOUR_ID = 'you-uuid';

/** Five seats: you and four strangers. */
const SEATS = 5;
/**
 * Read off the settings rather than written in, so turning the round length
 * dial does not break tests that are not about round length.
 */
const { turnsEach } = DEFAULT_SETTINGS;
/** Lines a full round produces with nobody timing out or walking away. */
const LINES_PER_ROUND = SEATS * turnsEach;

/**
 * The room is seated with `Math.random`, so it is pinned for the duration of a
 * test: you take the first seat and the first stranger is the impostor.
 */
function withFixedRandom<T>(value: number, run: () => T): T {
  const real = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = real;
  }
}

/**
 * Seats, identified by id only. The names passed in survive as ids and nothing
 * else — `startMatch` deals every seat its own colour, so whatever a fixture
 * calls somebody is gone by the time the room exists.
 */
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

/** Dispatches a list of actions in order, like the transport would. */
function play(state: Room | null, ...actions: MatchAction[]): Room | null {
  return actions.reduce(roomReducer, state);
}

/** A seated room. Five players: you plus four strangers. */
function seated(): Room | null {
  return withFixedRandom(0, () =>
    roomReducer(null, {
      type: 'startMatch',
      id: 'rm_test',
      yourId: YOUR_ID,
      strangers: strangers('Mara', 'Deniz', 'Kofi', 'Ines'),
    })
  );
}

function room(state: Room | null): Room {
  if (!state) throw new Error('expected a room');
  return state;
}

/** Answers out the current round, whoever is speaking, until the vote opens. */
function answerEveryTurn(state: Room | null): Room | null {
  let next = state;
  while (room(next).phase === 'answering') {
    next = roomReducer(next, {
      type: 'answerTurn',
      text: 'something',
      timedOut: false,
      replyToId: null,
    });
  }
  return next;
}

/** Everyone alive votes for `targetId`, you included. */
function everyoneVotesFor(state: Room | null, targetId: string): Room | null {
  return survivors(room(state)).reduce<Room | null>(
    (acc, voter) => roomReducer(acc, { type: 'castVote', voterId: voter.id, targetId }),
    state
  );
}

describe('seating', () => {
  it('gives you the durable player id you were seated with', () => {
    const state = seated();
    expect(room(state).youId).toBe(YOUR_ID);
    expect(playerById(room(state), YOUR_ID)?.isYou).toBe(true);
    expect(playerById(room(state), YOUR_ID)?.name).toMatch(/^Mr\. /);
  });

  it('opens on round one with everyone in the turn order', () => {
    const r = room(seated());
    expect(r.round).toBe(1);
    expect(r.phase).toBe('answering');
    expect(r.players).toHaveLength(SEATS);
    expect(r.turnOrder).toHaveLength(LINES_PER_ROUND);
  });
});

describe('answering', () => {
  it('opens the ballot once the last answer is in', () => {
    const state = answerEveryTurn(seated());
    expect(room(state).phase).toBe('voting');
    expect(room(state).voteEndsAt).not.toBeNull();
    expect(roundAnswers(room(state))).toHaveLength(LINES_PER_ROUND);
  });

  it('drops a reply pointing at an answer nobody can see', () => {
    const state = play(seated(), {
      type: 'answerTurn',
      text: 'hello',
      timedOut: false,
      replyToId: 'ans_nonexistent',
    });
    expect(roundAnswers(room(state))[0].replyToId).toBeNull();
  });

  it('keeps a reply pointing at an answer in this round', () => {
    const first = play(seated(), {
      type: 'answerTurn',
      text: 'hello',
      timedOut: false,
      replyToId: null,
    });
    const targetId = roundAnswers(room(first))[0].id;
    const second = play(first, {
      type: 'answerTurn',
      text: 'writing back',
      timedOut: false,
      replyToId: targetId,
    });
    expect(roundAnswers(room(second))[1].replyToId).toBe(targetId);
  });
});

describe('the transcript', () => {
  it('keeps every round, and shows only the one being played', () => {
    const voted = everyoneVotesFor(answerEveryTurn(seated()), 'p_deniz');
    const roundOneLines = room(voted).transcript.length;
    expect(roundOneLines).toBe(LINES_PER_ROUND);

    const next = play(voted, { type: 'nextRound' });
    // Nothing was thrown away, but the room has moved on.
    expect(room(next).transcript).toHaveLength(roundOneLines);
    expect(roundAnswers(room(next))).toHaveLength(0);
    expect(room(next).round).toBe(2);

    const spoken = play(next, {
      type: 'answerTurn',
      text: 'round two',
      timedOut: false,
      replyToId: null,
    });
    expect(room(spoken).transcript).toHaveLength(roundOneLines + 1);
    expect(roundAnswers(room(spoken))).toHaveLength(1);
  });

  it('records a departure in the round it happened in', () => {
    const state = play(seated(), { type: 'playerLeft', playerId: 'p_kofi' });
    const departure = room(state).transcript.at(-1);
    expect(departure?.kind).toBe('departure');
    expect(departure?.playerId).toBe('p_kofi');
    expect(departure?.round).toBe(1);
  });
});

describe('the ballot', () => {
  it('stays closed until the last vote is in, then resolves', () => {
    const voting = answerEveryTurn(seated());
    const alive = survivors(room(voting));

    const allButOne = alive
      .slice(0, -1)
      .reduce(
        (acc, voter) =>
          roomReducer(acc, { type: 'castVote', voterId: voter.id, targetId: 'p_mara' }),
        voting
      );
    expect(room(allButOne).ballotClosed).toBe(false);
    expect(room(allButOne).phase).toBe('voting');

    const last = alive[alive.length - 1];
    const closed = roomReducer(allButOne, {
      type: 'castVote',
      voterId: last.id,
      targetId: 'p_mara',
    });
    expect(room(closed).ballotClosed).toBe(true);
    expect(room(closed).phase).toBe('verdict');
    expect(room(closed).eliminatedId).toBe('p_mara');
  });

  it('ignores a second vote from the same player', () => {
    const voting = answerEveryTurn(seated());
    const once = roomReducer(voting, {
      type: 'castVote',
      voterId: YOUR_ID,
      targetId: 'p_mara',
    });
    const twice = roomReducer(once, {
      type: 'castVote',
      voterId: YOUR_ID,
      targetId: 'p_deniz',
    });
    expect(room(twice).votes[YOUR_ID]).toBe('p_mara');
    expect(room(twice).voted.filter((id) => id === YOUR_ID)).toHaveLength(1);
  });

  it('closes on the clock with everyone silent counted as naming nobody', () => {
    const closed = play(answerEveryTurn(seated()), { type: 'closeBallot' });
    expect(room(closed).ballotClosed).toBe(true);
    expect(room(closed).eliminatedId).toBeNull();
    expect(Object.keys(room(closed).votes)).toHaveLength(0);
    expect(room(closed).phase).toBe('verdict');
  });
});

describe('ties', () => {
  /** Two votes each for two people, with the fifth abstaining. */
  function tiedBallot(state: Room | null): Room | null {
    const voting = answerEveryTurn(state);
    const alive = survivors(room(voting)).map((p) => p.id);
    return play(
      voting,
      { type: 'castVote', voterId: alive[0], targetId: 'p_mara' },
      { type: 'castVote', voterId: alive[1], targetId: 'p_mara' },
      { type: 'castVote', voterId: alive[2], targetId: 'p_deniz' },
      { type: 'castVote', voterId: alive[3], targetId: 'p_deniz' },
      { type: 'castVote', voterId: alive[4], targetId: null }
    );
  }

  /** A tie, then the beat where the room is told, then the tiebreaker itself. */
  function throughTheTie(state: Room | null): Room | null {
    return play(tiedBallot(state), { type: 'nextRound' });
  }

  it('stops at the result and says who tied, before anything reopens', () => {
    const tied = tiedBallot(seated());
    expect(room(tied).phase).toBe('verdict');
    expect(room(tied).pendingTiebreaker).toEqual(
      expect.arrayContaining(['p_mara', 'p_deniz'])
    );
    // Not in the tiebreaker yet — the room is being told about it, which is a
    // different thing from talking it out.
    expect(room(tied).tiebreaker).toBeNull();
    expect(room(tied).eliminatedId).toBeNull();
    expect(room(tied).ballotClosed).toBe(true);
    // The votes are still there to be read back on the result screen.
    expect(Object.keys(room(tied).votes)).toHaveLength(4);
  });

  it('reopens the room to talk it out when that result ends', () => {
    const talking = throughTheTie(seated());
    expect(room(talking).tiebreaker).toEqual(expect.arrayContaining(['p_mara', 'p_deniz']));
    expect(room(talking).pendingTiebreaker).toBeNull();
    expect(room(talking).phase).toBe('answering');
    expect(room(talking).eliminatedId).toBeNull();
    expect(room(talking).votes).toEqual({});
    expect(room(talking).ballotClosed).toBe(false);
  });

  it('goes into the tiebreaker rather than on to the next round', () => {
    const before = room(seated()).round;
    expect(room(throughTheTie(seated())).round).toBe(before);
  });

  it('leaves the accused votable but does not narrow the ballot to them', () => {
    const talking = throughTheTie(seated());
    // Everyone alive still votes, and everyone alive can still be named.
    expect(survivors(room(talking))).toHaveLength(5);
  });

  it('spends the round when the tiebreaker ties too', () => {
    const twice = tiedBallot(throughTheTie(seated()));
    expect(room(twice).phase).toBe('verdict');
    expect(room(twice).pendingTiebreaker).toBeNull();
    expect(room(twice).eliminatedId).toBeNull();
    expect(room(twice).outcome).toBeNull();
    expect(survivors(room(twice))).toHaveLength(5);
  });

  it('drops the tiebreaker if one of the two walks out while it is announced', () => {
    // A tiebreaker between one player is not a tiebreaker, and handing the
    // elimination to whoever stayed would make quitting a way to remove people.
    const tied = tiedBallot(seated());
    const left = play(tied, { type: 'playerLeft', playerId: 'p_mara' });

    expect(room(left).pendingTiebreaker).toBeNull();
    expect(room(left).phase).toBe('verdict');
    expect(room(left).eliminatedId).toBeNull();
  });
});

describe('walking out', () => {
  it('takes their vote with them and their turns out of the order', () => {
    const state = seated();
    const before = room(state).turnOrder.length;
    const left = play(state, { type: 'playerLeft', playerId: 'p_kofi' });

    expect(playerById(room(left), 'p_kofi')?.connected).toBe(false);
    expect(room(left).turnOrder).not.toContain('p_kofi');
    // Every turn of theirs goes, not just the next one.
    expect(room(left).turnOrder).toHaveLength(before - turnsEach);
    expect(survivors(room(left))).toHaveLength(4);
  });

  it('can be the thing that closes the ballot', () => {
    const voting = answerEveryTurn(seated());
    const alive = survivors(room(voting)).map((p) => p.id);
    const waitingOnKofi = alive
      .filter((id) => id !== 'p_kofi')
      .reduce(
        (acc, voter) =>
          roomReducer(acc, { type: 'castVote', voterId: voter, targetId: 'p_mara' }),
        voting
      );
    expect(room(waitingOnKofi).ballotClosed).toBe(false);

    const gone = roomReducer(waitingOnKofi, { type: 'playerLeft', playerId: 'p_kofi' });
    expect(room(gone).ballotClosed).toBe(true);
    expect(room(gone).eliminatedId).toBe('p_mara');
  });

  it('does not hand the elimination to whoever is left in a tiebreaker', () => {
    const voting = answerEveryTurn(seated());
    const alive = survivors(room(voting)).map((p) => p.id);
    const tied = play(
      voting,
      { type: 'castVote', voterId: alive[0], targetId: 'p_mara' },
      { type: 'castVote', voterId: alive[1], targetId: 'p_mara' },
      { type: 'castVote', voterId: alive[2], targetId: 'p_deniz' },
      { type: 'castVote', voterId: alive[3], targetId: 'p_deniz' },
      { type: 'castVote', voterId: alive[4], targetId: null }
    );

    const quit = roomReducer(tied, { type: 'playerLeft', playerId: 'p_mara' });
    // Quitting is not a way to remove the person you were up against.
    expect(playerById(room(quit), 'p_deniz')?.eliminated).toBe(false);
    expect(room(quit).eliminatedId).toBeNull();
  });
});

describe('who wins', () => {
  it('ends it the moment the impostor is voted out', () => {
    const state = seated();
    const impostorId = room(state).impostorId;
    expect(impostorId).toBe('p_mara'); // pinned by the fixed random

    const decided = everyoneVotesFor(answerEveryTurn(state), impostorId!);
    expect(room(decided).outcome).toBe('humans');
    expect(room(decided).phase).toBe('verdict');
  });

  it('gives it to the impostor once one human is left', () => {
    // Four humans and the impostor: vote out humans until one remains.
    let state = seated();
    for (const target of ['p_deniz', 'p_kofi']) {
      state = everyoneVotesFor(answerEveryTurn(state), target);
      expect(room(state).outcome).toBeNull();
      state = roomReducer(state, { type: 'nextRound' });
    }
    state = everyoneVotesFor(answerEveryTurn(state), 'p_ines');
    // You and the impostor: you can always be outvoted.
    expect(room(state).outcome).toBe('impostor');
  });

  it('counts a human who walks out as one the impostor no longer has to fool', () => {
    let state = seated();
    state = play(
      state,
      { type: 'playerLeft', playerId: 'p_deniz' },
      { type: 'playerLeft', playerId: 'p_kofi' }
    );
    expect(room(state).outcome).toBeNull();
    state = roomReducer(state, { type: 'playerLeft', playerId: 'p_ines' });
    expect(room(state).outcome).toBe('impostor');
  });
});

describe('the verdict clock', () => {
  it('runs down on a round the room still has to play out', () => {
    const decided = everyoneVotesFor(answerEveryTurn(seated()), 'p_deniz');
    expect(room(decided).phase).toBe('verdict');
    expect(room(decided).verdictEndsAt).not.toBeNull();
    expect(room(decided).verdictEndsAt! - Date.now()).toBeGreaterThan(0);
  });

  it('counts down to nothing once the match is decided', () => {
    // Mara is the impostor, pinned by the fixed random.
    const over = everyoneVotesFor(answerEveryTurn(seated()), 'p_mara');
    expect(room(over).outcome).toBe('humans');
    expect(room(over).verdictEndsAt).toBeNull();
  });

  it('is cleared again once the next round opens', () => {
    const next = play(
      everyoneVotesFor(answerEveryTurn(seated()), 'p_deniz'),
      { type: 'nextRound' }
    );
    expect(room(next).verdictEndsAt).toBeNull();
    expect(room(next).phase).toBe('answering');
  });
});

describe('waking up to a stale clock', () => {
  // Coming back from the background re-arms every deadline at once, so an
  // action can arrive against a room that has already dealt with it.
  it('ignores a round advance once the round has already started', () => {
    const started = play(
      everyoneVotesFor(answerEveryTurn(seated()), 'p_deniz'),
      { type: 'nextRound' },
      { type: 'answerTurn', text: 'round two', timedOut: false, replyToId: null }
    );
    const again = play(started, { type: 'nextRound' });
    expect(room(again).round).toBe(2);
    expect(roundAnswers(room(again))).toHaveLength(1);
  });

  it('ignores a round advance once the match is over', () => {
    const over = everyoneVotesFor(answerEveryTurn(seated()), 'p_mara');
    const again = play(over, { type: 'nextRound' });
    expect(room(again).outcome).toBe('humans');
    expect(room(again).round).toBe(1);
  });

  it('ignores a ballot close on a ballot that already closed', () => {
    const closed = everyoneVotesFor(answerEveryTurn(seated()), 'p_deniz');
    const again = play(closed, { type: 'closeBallot' });
    expect(room(again)).toBe(room(closed));
  });

  it('ignores an expired turn once the room has moved to the vote', () => {
    const voting = answerEveryTurn(seated());
    const again = play(voting, { type: 'answerTurn', text: '', timedOut: true, replyToId: null });
    expect(room(again)).toBe(room(voting));
  });
});

describe('seat names', () => {
  it('names every seat, including yours, out of the one pool', () => {
    const players = room(seated()).players;
    expect(players.every((p) => /^Mr\. [A-Z][a-z]+$/.test(p.name))).toBe(true);
    // The tell this exists to close: your seat must not be namable apart from
    // the rest, because the impostor's is named by whatever names yours.
    expect(playerById(room(seated()), YOUR_ID)?.name).toMatch(/^Mr\. /);
  });

  it('never seats two players with the same name', () => {
    const names = room(seated()).players.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every seat a tint to render it with', () => {
    expect(room(seated()).players.every((p) => /^#[0-9a-f]{6}$/.test(p.tint))).toBe(true);
  });
});

describe('voteResult', () => {
  it('names everyone level at the top rather than giving up', () => {
    const voting = answerEveryTurn(seated());
    const alive = survivors(room(voting)).map((p) => p.id);
    const split = play(
      voting,
      { type: 'castVote', voterId: alive[0], targetId: 'p_mara' },
      { type: 'castVote', voterId: alive[1], targetId: 'p_deniz' }
    );
    expect(voteResult(room(split))).toEqual({
      kind: 'tied',
      playerIds: expect.arrayContaining(['p_mara', 'p_deniz']),
    });
  });
});

describe('swearing, on the way into the room', () => {
  const answered = (text: string) =>
    room(
      play(seated(), { type: 'answerTurn', text, timedOut: false, replyToId: null })
    ).transcript.at(-1)!.text;

  it('stars an answer once, where every reader of it agrees', () => {
    // Starred in the reducer rather than at render, so the bubble, the quote,
    // the transcript, the log and the facts handed to the impostor are all
    // the same string and there is no second place to forget.
    expect(answered('fuck this game')).toBe('**** this game');
  });

  it('leaves an ordinary answer exactly as typed', () => {
    expect(answered('pepperoni')).toBe('pepperoni');
  });

  it('does not star the football team', () => {
    expect(answered('i support arsenal')).toBe('i support arsenal');
  });
});
