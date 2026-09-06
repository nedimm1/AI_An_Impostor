/**
 * How a person behaves in a room, as opposed to what they say.
 *
 * The words are the obvious half of passing for human and the easy half to
 * fix. The half that gives a room away is everything around them: how long
 * somebody takes, whether the length of what they wrote has anything to do
 * with it, whether they answer at all, and whether they are following the
 * conversation or just answering the question.
 *
 * This lives on its own because the impostor has to draw from the same
 * distribution as everybody else. A model that writes perfectly but answers
 * every turn in a flat 1.4-4.6 seconds is findable without reading a word of
 * it — so when the impostor's answers start coming from a model, they get
 * their timing from here, exactly like the stand-ins do now.
 */

import type { Answer } from './types';

/**
 * Standard normal, Box-Muller. The point of using it is the tail: human
 * response times are not spread evenly between a floor and a ceiling, they
 * cluster and then trail off badly, and the trailing off is what makes
 * somebody look like a person with a life going on around them.
 */
function gaussian() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * How much the length of an answer pushes it later into the turn. Tuned so a
 * one-word answer almost always lands and a long one is often still being
 * typed when the clock goes — which is the right way round, and is what makes
 * the room's timed-out messages look like people rather than like a coin flip.
 */
const LENGTH_AT_FULL = 90;
const EARLIEST_SHARE = 0.22;
const LENGTH_SHARE = 0.45;
/** Spread of the tail. Higher means more people trailing off and missing. */
const SPREAD = 0.55;

/**
 * When in their turn somebody sends, in milliseconds.
 *
 * Expressed against the window they were given rather than as a fixed range,
 * so it holds up whatever `answerSeconds` is set to — a room on a four second
 * clock and a room on a forty-five second one should both look like people
 * typing, not like a timer with a constant added to it.
 *
 * A result past the end of the window is not a bug. That is somebody who was
 * still typing when their time went, and the room hears nothing from them —
 * which people do constantly, and a model that never does stands out.
 */
export function answerDelay(text: string, windowMs: number) {
  const length = Math.min(1, text.length / LENGTH_AT_FULL);
  const share = EARLIEST_SHARE + length * LENGTH_SHARE;
  return share * Math.exp(gaussian() * SPREAD) * windowMs;
}

/** True when this one ran past the clock and never landed. */
export function missesTurn(delayMs: number, windowMs: number) {
  return delayMs >= windowMs;
}

/**
 * When somebody locks their vote in, in milliseconds.
 *
 * Same shape as an answer and for the same reason, but with no length to go
 * on and a wider spread: some people know immediately and some sit on it until
 * the ballot is closing. A result past the window is somebody who never
 * locked in at all, which the room counts as naming nobody.
 */
const VOTE_EARLIEST_SHARE = 0.3;
const VOTE_SPREAD = 0.7;

export function voteDelay(windowMs: number) {
  return VOTE_EARLIEST_SHARE * Math.exp(gaussian() * VOTE_SPREAD) * windowMs;
}

/**
 * Talking back is contagious. A room answering the prompt cold keeps doing
 * that; the moment somebody quotes somebody, the next few people pile in. A
 * flat per-message chance produces neither, and reads as evenly sprinkled.
 *
 * It also has to build. The second person to speak in a round is answering a
 * question in a room with one line in it, and a room with one line in it is
 * not yet a conversation — somebody who opens by talking back at the only
 * other person who has spoken has put the whole room's attention on the two of
 * them, which is a thing people notice and, for the impostor, exactly the
 * thing it cannot afford. So the cold chance ramps with how much is on screen
 * and starts at nothing.
 */
const REPLY_CHANCE_COLD = 0.2;
const REPLY_CHANCE_IN_THREAD = 0.55;
/** Lines that have to be up before talking back is at full strength. */
const REPLY_RAMP = 4;

/** How far back people bother to reach. Recent first, and steeply so. */
const REACH_BACK = 4;
const RECENCY_BIAS = 2.2;

/**
 * Something to write back at, or null to answer the prompt cold. Pass the
 * answers to the round being played — reaching into an earlier round would
 * point at something nobody can see any more.
 */
export function pickReplyTarget(answers: Answer[]) {
  const spoken = answers.filter((a) => a.kind === 'answer' && !a.timedOut);
  if (spoken.length === 0) return null;

  const lastWasReply = spoken[spoken.length - 1].replyToId !== null;
  // Nobody replies to the first thing anybody said. From there it climbs.
  const warmth = Math.min(1, (spoken.length - 1) / REPLY_RAMP);
  const chance = lastWasReply ? REPLY_CHANCE_IN_THREAD : REPLY_CHANCE_COLD * warmth;
  if (Math.random() > chance) return null;

  // Weighted so the thing just said is far likelier to be picked up than
  // something four turns ago that the room has moved past.
  const recent = spoken.slice(-REACH_BACK);
  const weights = recent.map((_, i) => Math.pow(RECENCY_BIAS, i));
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = Math.random() * total;
  for (let i = 0; i < recent.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return recent[i].id;
  }
  return recent[recent.length - 1].id;
}
