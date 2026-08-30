/**
 * Placeholder content so the shell is walkable end to end. Everything here gets
 * replaced once rooms are backed by a server and the impostor is a model.
 */

import type { Message, Player } from './types';

export const PROMPTS = [
  'What is the most overrated food, and why are you right?',
  'Describe the last time you were genuinely embarrassed.',
  'What is a hill you would actually die on?',
  'What did you think you would be doing at this age?',
  'What is the worst advice you have ever been given?',
  'Name something everyone likes that you secretly hate.',
];

const BOT_NAMES = ['Mara', 'Deniz', 'Kofi', 'Sasha', 'Jonas', 'Priya', 'Emil'];

export function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Fills a lobby with stand-in players so the layout has something to show. */
export function mockPlayers(count: number, hostIsYou: boolean): Player[] {
  const names = [...BOT_NAMES].sort(() => Math.random() - 0.5).slice(0, count);
  return names.map((name, i) => ({
    id: `bot_${name.toLowerCase()}`,
    name,
    isHost: !hostIsYou && i === 0,
    isYou: false,
    isReady: Math.random() > 0.35,
    connected: true,
  }));
}

export function systemMessage(text: string): Message {
  return {
    id: makeId('sys'),
    kind: 'system',
    playerId: '',
    text,
    createdAt: Date.now(),
  };
}

const OPENERS = [
  'ok whoever answers first is instantly sus',
  'genuinely the worst prompt so far',
  'im typing slow on purpose btw',
  'we did this exact one last game lol',
  'nobody say anything for 10 seconds',
];

/** A couple of seeded lines so an empty chat doesn't look broken. */
export function mockOpeningChat(players: Player[]): Message[] {
  const others = players.filter((p) => !p.isYou);
  return others.slice(0, 3).map((p, i) => ({
    id: makeId('msg'),
    kind: 'chat' as const,
    playerId: p.id,
    text: OPENERS[i % OPENERS.length],
    createdAt: Date.now() + i,
  }));
}
