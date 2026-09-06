/**
 * These are distributions, not values, so the assertions are about shape and
 * the bounds are deliberately loose — a test that pins a random number down is
 * a test that fails on a Tuesday for no reason.
 */

import { answerDelay, missesTurn, pickReplyTarget, voteDelay } from './humanlike';
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
