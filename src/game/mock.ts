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

let lastAnswerIndex = -1;

/**
 * What a stand-in player types when their turn comes round. Never repeats the
 * line it just used — a round holds a dozen-plus of these and duplicates
 * back to back read as a bug rather than as filler.
 */
export function mockAnswer() {
  let index = Math.floor(Math.random() * STOCK_ANSWERS.length);
  if (index === lastAnswerIndex) index = (index + 1) % STOCK_ANSWERS.length;
  lastAnswerIndex = index;
  return STOCK_ANSWERS[index];
}
