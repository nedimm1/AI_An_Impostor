/**
 * Placeholder content so the shell is walkable end to end. Everything here gets
 * replaced once matchmaking is backed by a server and the impostor is a model.
 */

import promptList from './prompts.json';
import type { Player } from './types';

/**
 * Prompts have to be answerable off the top of your head — a turn is forty-five
 * seconds and the room comes back to the same prompt several times, so anything
 * that needs real thinking stalls it. They are small and ordinary on purpose: an impostor gives
 * itself away on the texture of an everyday answer, not on a hard one.
 *
 * The list lives in `prompts.json` so it can be added to without touching code.
 */
export const PROMPTS: string[] = promptList;

/**
 * A fresh order of prompts for one match, so two games never open on the same
 * question. Drawn once when the room is seated.
 */
export function shuffledPrompts() {
  return [...PROMPTS].sort(() => Math.random() - 0.5);
}

/** Stand-ins for the strangers the matchmaker seats you with. */
const STRANGER_NAMES = [
  'Mara',
  'Deniz',
  'Kofi',
  'Sasha',
  'Jonas',
  'Priya',
  'Emil',
  'Nadia',
  'Tomas',
  'Ines',
  'Rune',
  'Ayla',
];

/**
 * Filler answers. Deliberately vague — they have to read as plausible for any
 * prompt until a model is actually writing the impostor's turns.
 */
const STOCK_ANSWERS = [
  'honestly I had to think about this one for way too long',
  'my sister would say I am wrong about this but I stand by it',
  'ok this is going to make me sound insufferable but here goes',
  'I have a very specific memory attached to this and I hate it',
  'skipping the long version, short version is yes',
  'genuinely cannot answer this without starting an argument',
  'I changed my mind twice while typing this',
  'the boring answer is the true one here',
  'everyone I know disagrees with me and they are all wrong',
  'giving the answer I gave at 14 because nothing has improved',
  'I typed something else first and deleted it, take that as you will',
  'no notes, no elaboration, that is the answer',
  'this is going to be a boring answer sorry',
  'ok wait I have a good one for this actually',
  'depends entirely on the day you are asking me',
  'I feel like I should have a better answer than this',
  'genuinely the first thing that came into my head',
  'I have never been asked this and it shows',
  'my answer changes depending on who is asking',
  'putting far more thought into this than I should',
  'there is a long story here and nobody wants it',
  'I am going to regret being honest about this',
  'not the answer I want to give but it is the true one',
  'everyone always looks at me funny when I say this',
  'I asked my flatmate and now we are arguing',
  'this one is genuinely hard, give me a second',
  'I could go either way on this honestly',
  'saying the obvious one before somebody else does',
  'do not judge me for this one',
  'took me a minute to remember, it has been a while',
  'the honest answer and the good answer are different here',
  'I typed three versions of this and picked the worst one',
];

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Opaque session id. Nobody reads this out loud — it is not a room code. */
export function makeSessionId() {
  return makeId('rm');
}

/**
 * The strangers for one match. Names are drawn without repeats so the room
 * doesn't seat two people with the same handle.
 */
export function mockStrangers(count: number): Player[] {
  const names = [...STRANGER_NAMES].sort(() => Math.random() - 0.5).slice(0, count);
  return names.map((name) => ({
    id: `p_${name.toLowerCase()}`,
    name,
    isYou: false,
    connected: true,
    eliminated: false,
  }));
}

/**
 * How far back to remember. A round of seven players at three turns each is
 * twenty-one messages, so avoiding only the line just used is not enough —
 * two people saying the same sentence in one round reads as a bug, and it is
 * the first thing anybody notices about the room.
 */
const NO_REPEATS_WITHIN = 16;

const recentAnswers: string[] = [];

/** What a stand-in player types when their turn comes round. */
export function mockAnswer() {
  const fresh = STOCK_ANSWERS.filter((a) => !recentAnswers.includes(a));
  const pool = fresh.length > 0 ? fresh : STOCK_ANSWERS;
  const answer = pool[Math.floor(Math.random() * pool.length)];

  recentAnswers.push(answer);
  if (recentAnswers.length > NO_REPEATS_WITHIN) recentAnswers.shift();
  return answer;
}
