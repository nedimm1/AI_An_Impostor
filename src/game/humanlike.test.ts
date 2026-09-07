/**
 * These are distributions, not values, so the assertions are about shape and
 * the bounds are deliberately loose — a test that pins a random number down is
 * a test that fails on a Tuesday for no reason.
 */

import {
  answerDelay,
  answerDelayWithin,
  missesTurn,
  pickReplyTarget,
  voteDelay,
} from './humanlike';
import type { Answer } from './types';

const SAMPLES = 4000;
const WINDOW = 45_000;

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function delays(text: string, windowMs = WINDOW) {
  return Array.from({ length: SAMPLES }, () => answerDelay(text, windowMs));
}

function answer(id: string, over: Partial<Answer> = {}): Answer {
  return {
    id,
    kind: 'answer',
    playerId: `p_${id}`,
    round: 1,
    text: 'something',
    timedOut: false,
    inTiebreaker: false,
    replyToId: null,
    createdAt: 0,
    ...over,
  };
}

describe('how long somebody takes', () => {
  it('takes longer over a longer answer', () => {
    const short = median(delays('yeah'));
    const long = median(delays('x'.repeat(90)));
    expect(long).toBeGreaterThan(short * 1.5);
  });

  it('trails off rather than stopping at a ceiling', () => {
    const sample = delays('a fairly ordinary length of answer here');
    const mid = median(sample);
    const slowest = Math.max(...sample);
    // A flat range would put the slowest close to the middle. A tail does not.
    expect(slowest).toBeGreaterThan(mid * 2.5);
  });

  it('scales with the turn it is given rather than being a fixed range', () => {
    const short = median(delays('an ordinary answer', 4_000));
    const long = median(delays('an ordinary answer', 40_000));
    const ratio = long / short;
    expect(ratio).toBeGreaterThan(7);
    expect(ratio).toBeLessThan(13);
  });

  it('loses some people to the clock, but nothing like most of them', () => {
    const sample = delays('an answer of fairly ordinary length');
    const missed = sample.filter((d) => missesTurn(d, WINDOW)).length / sample.length;
    expect(missed).toBeGreaterThan(0.01);
    expect(missed).toBeLessThan(0.3);
  });

  it('loses more of the people writing long answers', () => {
    const rate = (text: string) =>
      delays(text).filter((d) => missesTurn(d, WINDOW)).length / SAMPLES;
    expect(rate('x'.repeat(90))).toBeGreaterThan(rate('yeah'));
  });
});

/**
 * The one seat that has to land. Only the test harness uses it: in a match the
 * impostor misses turns like everybody else, and that is deliberate.
 */
describe('the answer that is not allowed to miss', () => {
  const within = (text: string) =>
    Array.from({ length: SAMPLES }, () => answerDelayWithin(text, WINDOW));

  it('never runs past the clock, however long the answer', () => {
    const sample = within('x'.repeat(200));
    expect(sample.filter((d) => missesTurn(d, WINDOW))).toHaveLength(0);
  });

  it('leaves room to send before the room enforces the deadline', () => {
    expect(Math.max(...within('x'.repeat(200)))).toBeLessThan(WINDOW * 0.9);
  });

  // Clamping the tail is not the same as flattening the draw: what was going
  // to land on time still lands when it was going to.
  it('is the same draw everywhere it already fitted', () => {
    const clamped = median(within('yeah'));
    const raw = median(delays('yeah'));
    expect(Math.abs(clamped - raw) / raw).toBeLessThan(0.15);
  });

  it('still takes longer over a longer answer', () => {
    expect(median(within('x'.repeat(90)))).toBeGreaterThan(median(within('yeah')));
  });
});

describe('the turn everybody is answering on', () => {
  // Five people asked the same question in turn is not a conversation, and
  // spending your go on somebody else's answer is a go where you never gave
  // one: pineapple is on screen, and instead of saying pepperoni it said that
  // pineapple is not a topping.
  const round = [
    answer('a', { playerId: 'p_nedim', text: 'pineapple' }),
    answer('b', { playerId: 'p_emil', text: 'mushroom' }),
    answer('c', { playerId: 'p_kofi', text: 'plain cheese' }),
  ];

  const rate = (selfId?: string) =>
    Array.from({ length: SAMPLES }, () => pickReplyTarget(round, selfId)).filter(Boolean)
      .length / SAMPLES;

  it('mostly just answers, when it has not answered yet', () => {
    expect(rate('p_you')).toBeLessThan(0.2);
  });

  it('does not go silent about it either', () => {
    expect(rate('p_you')).toBeGreaterThan(0.05);
  });

  it('talks back far more once its own answer is in', () => {
    const spokenAlready = [...round, answer('d', { playerId: 'p_you', text: 'pepperoni' })];
    const after =
      Array.from({ length: SAMPLES }, () =>
        pickReplyTarget(spokenAlready, 'p_you')
      ).filter(Boolean).length / SAMPLES;
    expect(after).toBeGreaterThan(rate('p_you') * 2);
  });
});

describe('being written at', () => {
  const spoken = [
    answer('a', { playerId: 'p_nedim', text: 'the office' }),
    answer('b', { playerId: 'p_you', text: 'only 12 eps' }),
    answer('c', { playerId: 'p_emil', text: 'true', replyToId: 'b' }),
    answer('d', { playerId: 'p_kofi', text: 'lol' }),
  ];

  const picks = (selfId?: string) =>
    Array.from({ length: SAMPLES }, () => pickReplyTarget(spoken, selfId));

  // A reply arrives with your own words quoted in it. Carrying on as though
  // it had not is the thing people notice.
  it('usually writes back at whoever wrote at you', () => {
    const rate = picks('p_you').filter((id) => id === 'c').length / SAMPLES;
    expect(rate).toBeGreaterThan(0.6);
  });

  it('reaches past a newer message to do it', () => {
    // 'd' is the most recent line; 'c' is the one aimed at this player.
    const sample = picks('p_you');
    expect(sample.filter((id) => id === 'c').length).toBeGreaterThan(
      sample.filter((id) => id === 'd').length
    );
  });

  // The bug this exists for: the same question got answered every turn for
  // the rest of the round while the room moved on to something else.
  it('lets go of a reply once it has written back', () => {
    const andBack = [
      ...spoken,
      answer('e', { playerId: 'p_you', text: 'yeah', replyToId: 'c' }),
      answer('f', { playerId: 'p_nedim', text: 'anyway' }),
    ];
    expect(
      Array.from({ length: SAMPLES }, () => pickReplyTarget(andBack, 'p_you')).filter(
        (id) => id === 'c'
      )
    ).toHaveLength(0);
  });

  it('picks up a fresh one written at it after that', () => {
    const askedAgain = [
      ...spoken,
      answer('e', { playerId: 'p_you', text: 'yeah', replyToId: 'c' }),
      answer('f', { playerId: 'p_nedim', text: 'which season though', replyToId: 'e' }),
    ];
    const rate =
      Array.from({ length: SAMPLES }, () => pickReplyTarget(askedAgain, 'p_you')).filter(
        (id) => id === 'f'
      ).length / SAMPLES;
    expect(rate).toBeGreaterThan(0.6);
  });

  it('never writes back at the same message twice', () => {
    const already = [
      answer('a', { playerId: 'p_nedim', text: 'the office' }),
      answer('b', { playerId: 'p_you', text: 'agreed', replyToId: 'a' }),
      answer('c', { playerId: 'p_emil', text: 'sure' }),
      answer('d', { playerId: 'p_kofi', text: 'lol' }),
    ];
    expect(
      Array.from({ length: SAMPLES }, () => pickReplyTarget(already, 'p_you')).filter(
        (id) => id === 'a'
      )
    ).toHaveLength(0);
  });

  it('leaves everybody else on the ordinary draw', () => {
    const rate = picks('p_kofi').filter((id) => id === 'c').length / SAMPLES;
    expect(rate).toBeLessThan(0.5);
  });

  it('is nobody\'s reply when the seat is not given', () => {
    expect(picks().filter((id) => id === 'c').length / SAMPLES).toBeLessThan(0.5);
  });
});

describe('when the room locks in', () => {
  const votes = (windowMs = WINDOW) =>
    Array.from({ length: SAMPLES }, () => voteDelay(windowMs));

  it('fills the ballot a name at a time rather than all at once', () => {
    const sample = votes().filter((d) => !missesTurn(d, WINDOW)).sort((a, b) => a - b);
    const first = sample[Math.floor(sample.length * 0.1)];
    const last = sample[Math.floor(sample.length * 0.9)];
    expect(last).toBeGreaterThan(first * 3);
  });

  it('leaves some people never locking in at all', () => {
    const missed = votes().filter((d) => missesTurn(d, WINDOW)).length / SAMPLES;
    expect(missed).toBeGreaterThan(0.02);
    expect(missed).toBeLessThan(0.35);
  });

  it('scales with the ballot rather than being a fixed range', () => {
    const ratio = median(votes(60_000)) / median(votes(15_000));
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(5);
  });
});

describe('who talks back to whom', () => {
  it('has nobody to answer before anybody has spoken', () => {
    expect(pickReplyTarget([])).toBeNull();
  });

  it('does not write back at somebody who never said anything', () => {
    const silent = [answer('a', { timedOut: true }), answer('b', { kind: 'departure' })];
    expect(pickReplyTarget(silent)).toBeNull();
  });

  const replyRate = (answers: Answer[]) =>
    Array.from({ length: SAMPLES }, () => pickReplyTarget(answers)).filter(Boolean).length /
    SAMPLES;

  it('piles into a thread that has already started', () => {
    const cold = [answer('a'), answer('b'), answer('c'), answer('d'), answer('e')];
    const thread = [answer('a'), answer('b'), answer('c'), answer('d'), answer('e', { replyToId: 'a' })];
    expect(replyRate(thread)).toBeGreaterThan(replyRate(cold) * 1.8);
  });

  it('never talks back at the only person who has spoken', () => {
    // Going second into a room with one line in it. Answering that line puts
    // the room's attention on the pair of you, which is the last thing the
    // impostor wants and not what people do anyway.
    expect(replyRate([answer('a')])).toBe(0);
  });

  it('warms up as the round fills', () => {
    const upTo = (n: number) => Array.from({ length: n }, (_, i) => answer(`p${i}`));
    expect(replyRate(upTo(2))).toBeLessThan(replyRate(upTo(5)));
  });

  it('reaches for what was just said far more than for what came before', () => {
    const answers = [answer('oldest'), answer('middle'), answer('newest', { replyToId: 'a' })];
    const picks = Array.from({ length: SAMPLES }, () => pickReplyTarget(answers)).filter(
      Boolean
    );
    const count = (id: string) => picks.filter((p) => p === id).length;
    expect(count('newest')).toBeGreaterThan(count('oldest') * 2);
  });
});
