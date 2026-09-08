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
 * The latest into a turn anybody sends when they are not allowed to miss it.
 * Short of the clock rather than on it, because the room enforces the deadline
 * a moment later and a message racing it is a message that might not arrive.
 */
const LATEST_SHARE = 0.85;

/**
 * The same draw, pulled back inside the window.
 *
 * For the one player who does not get to sit a turn out. In a match nobody is
 * exempt — somebody still typing when their time goes is a person, and an
 * impostor that never once misses is findable on that alone — but under the
 * test harness the impostor's turn is the only thing on screen worth reading,
 * and a quarter of them going silently missing is a quarter of the evidence.
 *
 * The draw is still the draw. This only refuses to let it fall off the end,
 * so a long answer still comes in late, just not never.
 */
export function answerDelayWithin(text: string, windowMs: number) {
  return Math.min(answerDelay(text, windowMs), windowMs * LATEST_SHARE);
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
const REPLY_CHANCE_COLD = 0.34;
const REPLY_CHANCE_IN_THREAD = 0.72;

/**
 * How often somebody talks back on the turn they are supposed to be
 * answering on.
 *
 * Low, because the first time round the room is not a conversation. Everybody
 * is being asked the same question in turn and putting up an answer, and the
 * person who uses their go to have a view about somebody else's answer has
 * not answered — asked for a pizza topping, with pineapple already on screen,
 * a reply saying that is not a topping is a turn where nobody ever found out
 * what they liked.
 *
 * It is not zero. Some people do answer by picking up what was just said, and
 * a room where the first pass is five clean answers every time is its own
 * kind of wrong.
 */
const REPLY_CHANCE_UNANSWERED = 0.12;

/**
 * The same person, once the room has stopped going round the question.
 *
 * The low rate above is true of a round that is still a queue, and only of
 * that. The question at the top is a conversation starter: the moment one
 * answer gets picked up and answered back, the room is talking rather than
 * taking turns, and posting a cold answer into the middle of that is the
 * conspicuous thing rather than the safe one. Somebody who has not answered
 * yet still talks back a little less than somebody who has - their answer is
 * the thing they have not said - which is why this sits under the in-thread
 * rate rather than at it.
 */
const REPLY_CHANCE_UNANSWERED_TALKING = 0.55;

/** Lines that have to be up before talking back is at full strength. */
const REPLY_RAMP = 3;

/**
 * How much of the room is answering each other rather than the question.
 *
 * Counted off the reply arrows over the last few lines, because that is the
 * one structural fact about a conversation the app already records. Two of
 * them is a back and forth; one is somebody picking up an answer in a round
 * that is otherwise still going round.
 */
const TALKING_WINDOW = 4;

function roomIsTalking(spoken: Answer[]) {
  const latest = spoken.slice(-TALKING_WINDOW);
  return latest.filter((a) => a.replyToId !== null).length >= 2;
}

/**
 * How often somebody who has just been replied to writes back.
 *
 * High, because this is not a choice people make. A reply arrives with your
 * own words quoted inside it and your name on the thread; answering it is the
 * default and ignoring it is the thing that takes a decision. The room reads
 * an unanswered reply as being blanked, and a player who is always the one
 * blanking people is a player the room ends up looking at.
 *
 * It sits above the in-thread chance on purpose: being in a conversation is
 * one thing, being spoken to directly is another.
 */
const REPLY_BACK_CHANCE = 0.78;

/** How far back people bother to reach. Recent first, and steeply so. */
const REACH_BACK = 4;
const RECENCY_BIAS = 2.2;

/**
 * How much harder a message pulls for every other person already in its
 * thread.
 *
 * Recency on its own gave everybody the same instinct — answer whatever was
 * said last — and over a round that turns into two people in a private back
 * and forth while the room's actual argument happens next to them. In one
 * real round the impostor spent five turns alternating between two seats and
 * never touched the row two other players were having about whether PB and J
 * is a child's answer, which ran for four messages and pulled in a third
 * person. Nobody sits out the loud thread. It is the one everybody is
 * reading.
 *
 * Measured over the whole thread rather than the one message, because that
 * is what a person is drawn to. Faced with a row three messages deep, nobody
 * replies to the line that started it — they answer the newest thing in it.
 * So the pull is spread over every message in the thread and recency picks
 * the target inside it, which lands on the last word of the argument, where
 * a person would.
 *
 * Its own lines are left out of the count. A thread is hot because other
 * people are in it, and a seat that counted its own replies would find its
 * own conversation hotter every time it spoke, which is the failure this is
 * here to fix.
 */
const HEAT_BIAS = 1.0;

/**
 * How much less the person you last wrote back at pulls the next time.
 *
 * Not zero, because two people going at it for a few messages is a real
 * thing that happens. It stops being one when it is every turn you take.
 */
const SAME_PARTNER_DAMP = 0.45;

/**
 * Something to write back at, or null to answer the prompt cold. Pass the
 * answers to the round being played — reaching into an earlier round would
 * point at something nobody can see any more.
 */
export function pickReplyTarget(answers: Answer[], selfId?: string | null) {
  const spoken = answers.filter((a) => a.kind === 'answer' && !a.timedOut);
  if (spoken.length === 0) return null;

  // A message you have already written back at is finished with. Answering it
  // again is not being attentive, it is being stuck: the room moves on and the
  // one player still going at a message from four turns ago is the one that
  // reads as not really following any of it.
  const answered = new Set(
    selfId
      ? spoken
          .filter((a) => a.playerId === selfId)
          .map((a) => a.replyToId)
          .filter((id): id is string => id !== null)
      : []
  );

  const open = spoken.filter((a) => !answered.has(a.id));
  if (open.length === 0) return null;

  // Somebody wrote back at you. That pulls harder than anything else on this
  // list — but only until you have spoken again. Once you have had your say
  // the thread is even, and whatever the room did next is what is on screen.
  if (selfId) {
    const yoursLast = spoken.reduce(
      (found, a, i) => (a.playerId === selfId ? i : found),
      -1
    );
    const yours = new Set(
      spoken.filter((a) => a.playerId === selfId).map((a) => a.id)
    );
    const atYou = spoken.filter(
      (a, i) =>
        i > yoursLast &&
        a.playerId !== selfId &&
        a.replyToId !== null &&
        yours.has(a.replyToId)
    );
    const latest = atYou[atYou.length - 1];
    if (latest && Math.random() < REPLY_BACK_CHANCE) return latest.id;
  }

  // Whether this seat still owes the room an answer. Everything below is
  // about talking back, and talking back is what you do once you have said
  // your piece — not instead of saying it.
  const hasAnswered = selfId ? spoken.some((a) => a.playerId === selfId) : true;

  const lastWasReply = spoken[spoken.length - 1].replyToId !== null;
  // Nobody replies to the first thing anybody said. From there it climbs.
  const warmth = Math.min(1, (spoken.length - 1) / REPLY_RAMP);
  const chance = !hasAnswered
    ? roomIsTalking(spoken)
      ? REPLY_CHANCE_UNANSWERED_TALKING
      : REPLY_CHANCE_UNANSWERED
    : lastWasReply
      ? REPLY_CHANCE_IN_THREAD
      : REPLY_CHANCE_COLD * warmth;
  if (Math.random() > chance) return null;

  // Who this seat was last in a thread with, so a second turn spent on them
  // is worth less than a first. Read off your own last reply rather than
  // tracked, because that is all "who you are talking to" means here.
  const lastPartner = (() => {
    if (!selfId) return null;
    const mine = spoken.filter((a) => a.playerId === selfId && a.replyToId !== null);
    const last = mine[mine.length - 1];
    if (!last) return null;
    return spoken.find((a) => a.id === last.replyToId)?.playerId ?? null;
  })();

  // The top of whatever thread a message belongs to, so everything hanging
  // off one line is measured together.
  const byId = new Map(spoken.map((a) => [a.id, a]));

  const rootOf = (answer: Answer) => {
    let node = answer;
    // Bounded: a transcript is not a data structure anybody has validated.
    for (let step = 0; node.replyToId && step < 20; step++) {
      const parent = byId.get(node.replyToId);
      if (!parent) break;
      node = parent;
    }
    return node.id;
  };

  const inThread = new Map<string, number>();
  for (const answer of spoken) {
    if (answer.playerId === selfId) continue;
    const root = rootOf(answer);
    inThread.set(root, (inThread.get(root) ?? 0) + 1);
  }

  // How many other people's messages are already gathered on this one.
  const heat = (target: Answer) =>
    Math.max(0, (inThread.get(rootOf(target)) ?? 1) - 1);

  // Weighted so the thing just said is far likelier to be picked up than
  // something four turns ago that the room has moved past — then pulled
  // towards whatever the room is actually gathered around, and away from the
  // seat this one has just been talking to.
  const recent = open.slice(-REACH_BACK);
  const weights = recent.map(
    (answer, i) =>
      Math.pow(RECENCY_BIAS, i) *
      (1 + HEAT_BIAS * heat(answer)) *
      (lastPartner && answer.playerId === lastPartner ? SAME_PARTNER_DAMP : 1)
  );
  const total = weights.reduce((sum, w) => sum + w, 0);

  let roll = Math.random() * total;
  for (let i = 0; i < recent.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return recent[i].id;
  }
  return recent[recent.length - 1].id;
}
