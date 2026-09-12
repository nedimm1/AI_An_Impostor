/**
 * What the impostor is allowed to know.
 *
 * This is a rule of the game, not a detail of the integration: an impostor
 * shown the whole match sees things no player at that table can see, and one
 * shown too little contradicts itself. Both are ways of losing the game to a
 * bug rather than to a room, so the reduction gets driven through the real
 * reducer like everything else.
 */

import { impostorBallot, impostorTurn } from './impostor';
import { roomReducer, type MatchAction } from './reducer';
import { currentTurnId, survivors, type Player, type Room } from './types';

const YOUR_ID = 'you-uuid';

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

function room(state: Room | null): Room {
  if (!state) throw new Error('expected a room');
  return state;
}

/** The first stranger is the impostor when `Math.random` is pinned to zero. */
function seated(): Room {
  return room(
    withFixedRandom(0, () =>
      roomReducer(null, {
        type: 'startMatch',
        id: 'rm_test',
        yourId: YOUR_ID,
          strangers: strangers('Mara', 'Deniz', 'Kofi', 'Ines'),
      })
    )
  );
}

function play(state: Room | null, ...actions: MatchAction[]): Room {
  return room(actions.reduce(roomReducer, state));
}

/** Each speaker says their own name, so a line can be traced to a seat. */
function answerAs(state: Room, text?: string): Room {
  const speaker = currentTurnId(state);
  return play(state, {
    type: 'answerTurn',
    text: text ?? `line from ${speaker}`,
    timedOut: false,
    replyToId: null,
  });
}

function answerEveryTurn(state: Room): Room {
  let next = state;
  while (next.phase === 'answering') next = answerAs(next);
  return next;
}

describe('what the impostor is told', () => {
  it('carries the round on screen, in order, with names', () => {
    let state = seated();
    state = answerAs(state, 'first');
    state = answerAs(state, 'second');

    const turn = impostorTurn(state);
    expect(turn.roundLines.map((line) => line.text)).toEqual(['first', 'second']);
    expect(turn.roundLines.every((line) => line.name.length > 0)).toBe(true);
    expect(turn.prompt).toBe(state.prompt);
  });

  // The transcript is not a roster: a player who walked out is still all over
  // it, and the impostor turned on one of them twice in a round they had left.
  it('says who is still in the room, which the transcript cannot', () => {
    let state = seated();
    const gone = state.players.find((p) => !p.isYou)!;
    state = play(state, { type: 'playerLeft', playerId: gone.id });

    const names = impostorTurn(state).stillIn;
    expect(names).not.toContain(gone.name);
    expect(names).toContain(state.players.find((p) => p.id === YOUR_ID)?.name);
  });

  it('sends the name the room already sees on its seat', () => {
    const state = seated();
    const seat = state.players.find((p) => p.id === state.impostorId)!;

    // Not a name of its own: the room is looking at this one, and its own
    // lines come back to it in the transcript under it.
    expect(impostorTurn(state).name).toBe(seat.name);
  });

  it('leaves out the turns nobody heard', () => {
    let state = seated();
    state = answerAs(state, 'spoken');
    state = play(state, { type: 'answerTurn', text: '', timedOut: true, replyToId: null });

    expect(impostorTurn(state).roundLines.map((l) => l.text)).toEqual(['spoken']);
  });

  it('remembers its own earlier rounds and nobody else\'s', () => {
    let state = seated();
    const impostorId = state.impostorId!;

    state = answerEveryTurn(state);
    state = survivors(state).reduce(
      (acc, voter) => play(acc, { type: 'castVote', voterId: voter.id, targetId: YOUR_ID }),
      state
    );
    state = play(state, { type: 'spectate' }, { type: 'nextRound' });
    expect(state.round).toBe(2);

    const turn = impostorTurn(state);
    // Round two is fresh, so nothing is on screen yet.
    expect(turn.roundLines).toEqual([]);
    // But it still knows what it said, and only what it said.
    expect(turn.ownHistory.length).toBeGreaterThan(0);
    expect(turn.ownHistory.every((line) => line.includes(impostorId))).toBe(true);
  });

  // The room draws a reply under the message it answers. Flattened to name
  // and text, the impostor could not see that anything had been aimed at it.
  it('carries who each line was written at, itself included', () => {
    let state = seated();
    state = answerAs(state, 'first');
    const target = state.transcript[0];
    state = play(state, {
      type: 'answerTurn',
      text: 'second',
      timedOut: false,
      replyToId: target.id,
    });

    const author = state.players.find((p) => p.id === target.playerId)!;
    const lines = impostorTurn(state).roundLines;
    expect(lines[0].replyToName).toBeNull();
    expect(lines[1].replyToName).toBe(author.name);
  });

  it('carries the message it is answering, so the words can be aimed at it', () => {
    let state = seated();
    state = answerAs(state, 'milk and bin bags');
    const target = state.transcript[0];
    const author = state.players.find((p) => p.id === target.playerId)!;

    const turn = impostorTurn(state, target.id);
    expect(turn.replyTo).toEqual({ name: author.name, text: 'milk and bin bags' });

    // Cold is the default, and the common case.
    expect(impostorTurn(state).replyTo).toBeNull();
  });

  it('will not point at a message from a round nobody can see any more', () => {
    let state = seated();
    state = answerAs(state, 'from round one');
    const stale = state.transcript[0].id;

    state = answerEveryTurn(state);
    state = survivors(state).reduce(
      (acc, voter) => play(acc, { type: 'castVote', voterId: voter.id, targetId: YOUR_ID }),
      state
    );
    state = play(state, { type: 'spectate' }, { type: 'nextRound' });

    expect(impostorTurn(state, stale).replyTo).toBeNull();
  });

  it('knows when it is the one on trial', () => {
    let state = seated();
    const impostorId = state.impostorId!;

    state = answerEveryTurn(state);
    // Two for the impostor, two for you, and its own vote spent elsewhere:
    // a two-two split puts both of you up.
    state = play(
      state,
      { type: 'castVote', voterId: YOUR_ID, targetId: impostorId },
      { type: 'castVote', voterId: 'p_deniz', targetId: impostorId },
      { type: 'castVote', voterId: 'p_kofi', targetId: YOUR_ID },
      { type: 'castVote', voterId: 'p_ines', targetId: YOUR_ID },
      { type: 'castVote', voterId: impostorId, targetId: 'p_kofi' }
    );

    // The tie gets a result of its own now; the tiebreaker opens when it ends.
    state = play(state, { type: 'nextRound' });

    expect(state.tiebreaker).toContain(impostorId);
    const turn = impostorTurn(state);
    expect(turn.tiebreaker).toBe(true);
    expect(turn.accused).toBe(true);
    // The prompt is the room's own wording for a tied vote, not the question.
    expect(turn.prompt).toBe(state.prompt);
  });
});

describe('what the impostor is told when it votes', () => {
  it('can name everybody still in except itself', () => {
    const state = seated();
    const names = impostorBallot(state).candidates;

    expect(names).not.toContain(
      state.players.find((p) => p.id === state.impostorId)?.name
    );
    expect(names).toHaveLength(survivors(state).length - 1);
    expect(names).toContain(state.players.find((p) => p.id === YOUR_ID)?.name);
  });

  it('drops anybody who has gone, however they went', () => {
    let state = seated();
    state = play(state, { type: 'playerLeft', playerId: 'p_kofi' });

    expect(impostorBallot(state).candidates).not.toContain('Kofi');
  });

  it('carries the round it is voting on, and who is up in a tiebreaker', () => {
    let state = seated();
    state = answerAs(state, 'went to my cousins wedding');

    const cold = impostorBallot(state);
    expect(cold.roundLines).toHaveLength(1);
    expect(cold.accused).toEqual([]);
    expect(cold.round).toBe(1);

    const impostorId = state.impostorId!;
    state = answerEveryTurn(state);
    state = play(
      state,
      { type: 'castVote', voterId: YOUR_ID, targetId: impostorId },
      { type: 'castVote', voterId: 'p_deniz', targetId: impostorId },
      { type: 'castVote', voterId: 'p_kofi', targetId: YOUR_ID },
      { type: 'castVote', voterId: 'p_ines', targetId: YOUR_ID },
      { type: 'castVote', voterId: impostorId, targetId: 'p_kofi' }
    );
    state = play(state, { type: 'nextRound' });

    const tied = impostorBallot(state);
    expect(tied.accused).toHaveLength(2);
    expect(tied.accused).toContain(
      state.players.find((p) => p.id === impostorId)?.name
    );
  });
});
