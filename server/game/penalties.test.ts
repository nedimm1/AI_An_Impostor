/**
 * Leaving a match early: the strike ladder, what forgives it, and the lobby
 * refusing a queue while the wait is on.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Matchmaking } from '../rules/transport';
import { currentTurnId, type Room } from '../rules/types';

import { Lobby, type LobbyEvents } from './lobby';
import type { ImpostorModel, Match } from './match';
import { COOLDOWN_LADDER_MS, Penalties, STRIKE_LIFETIME_MS, type Strike } from './penalties';

const MINUTE = 60_000;

describe('the strike ladder', () => {
  let now = 1_000_000;
  const clock = () => now;

  it('warns first, then climbs, then holds at the top', () => {
    const penalties = new Penalties(null, clock);
    const waits = [1, 2, 3, 4, 5].map(() => penalties.strike('p').cooldownMs);
    expect(waits).toEqual([0, 2 * MINUTE, 10 * MINUTE, 30 * MINUTE, 30 * MINUTE]);
    expect(COOLDOWN_LADDER_MS[0]).toBe(0);
  });

  it('counts the wait down', () => {
    const penalties = new Penalties(null, clock);
    penalties.strike('p');
    penalties.strike('p');
    expect(penalties.cooldownLeft('p')).toBe(2 * MINUTE);
    now += MINUTE;
    expect(penalties.cooldownLeft('p')).toBe(MINUTE);
    now += MINUTE;
    expect(penalties.cooldownLeft('p')).toBe(0);
  });

  it('forgives one strike for every match finished', () => {
    const penalties = new Penalties(null, clock);
    penalties.strike('p');
    penalties.strike('p');
    penalties.completed('p');
    expect(penalties.strikes('p')).toBe(1);
    // Back to one strike, so the next leave is the 2-minute one again, not 10.
    expect(penalties.strike('p').cooldownMs).toBe(2 * MINUTE);
  });

  it('lets a strike lapse after a day', () => {
    const penalties = new Penalties(null, clock);
    penalties.strike('p');
    now += STRIKE_LIFETIME_MS + 1;
    expect(penalties.strikes('p')).toBe(0);
    expect(penalties.strike('p').cooldownMs).toBe(0);
  });

  it('keeps the record across a restart', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'penalties-')), 'record.json');
    const before = new Penalties(file, clock);
    before.strike('p');
    before.strike('p');
    before.save();

    const after = new Penalties(file, clock);
    expect(after.strikes('p')).toBe(2);
    expect(after.cooldownLeft('p')).toBe(2 * MINUTE);
  });

  it('starts clean from a missing or broken file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'penalties-'));
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ not json');
    expect(new Penalties(broken, clock).strikes('p')).toBe(0);
    expect(new Penalties(path.join(dir, 'missing.json'), clock).strikes('p')).toBe(0);
  });
});

describe('the lobby', () => {
  const quietModel: ImpostorModel = { answer: async () => null, vote: async () => null };
  const person = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function lobbyWith(graceMs = 25_000) {
    const matches = new Set<Match>();
    const progress = new Map<string, Matchmaking>();
    const struck = new Map<string, Strike>();
    const coolingDown = new Map<string, number>();

    const events: LobbyEvents = {
      matchChanged: (m) => matches.add(m),
      queueChanged: (waiting, p) => waiting.forEach((id) => progress.set(id, p)),
      leftQueue: (id) => progress.delete(id),
      matchEnded: (m) => matches.delete(m),
      struck: (id, strike) => struck.set(id, strike),
      coolingDown: (id, ms) => coolingDown.set(id, ms),
    };

    const penalties = new Penalties();
    const lobby = new Lobby(quietModel, events, graceMs, penalties);
    return { lobby, matches, progress, struck, coolingDown, penalties };
  }

  function cleanUp(matches: Set<Match>) {
    for (const m of [...matches]) m.players().forEach((id) => m.leave(id));
  }

  it('strikes somebody who walks out of a match that is still going', () => {
    const { lobby, matches, struck } = lobbyWith();
    lobby.join(person(1), 4);
    lobby.join(person(2), 4);
    lobby.join(person(3), 4);

    lobby.leaveMatch(person(1));
    expect(struck.get(person(1))).toEqual({ strikes: 1, cooldownMs: 0 });
    cleanUp(matches);
  });

  it('does not strike the last person left in the room', () => {
    const { lobby, matches, struck } = lobbyWith();
    lobby.join(person(1), 3);
    lobby.join(person(2), 3);

    lobby.leaveMatch(person(1));
    lobby.leaveMatch(person(2));
    expect(struck.has(person(1))).toBe(true);
    expect(struck.has(person(2))).toBe(false);
    cleanUp(matches);
  });

  it('refuses a queue while the wait is on, and says how long', () => {
    const { lobby, matches, progress, coolingDown, penalties } = lobbyWith();
    penalties.strike(person(1));
    penalties.strike(person(1));

    lobby.join(person(1), 4);
    expect(coolingDown.get(person(1))).toBe(2 * MINUTE);
    expect(lobby.queuedFor(person(1))).toBeNull();
    expect(progress.has(person(1))).toBe(false);
    cleanUp(matches);
  });

  it('lets a first-time leaver straight back in', () => {
    const { lobby, matches, coolingDown } = lobbyWith();
    lobby.join(person(1), 3);
    lobby.join(person(2), 3);
    lobby.leaveMatch(person(1));

    lobby.join(person(1), 4);
    expect(coolingDown.has(person(1))).toBe(false);
    expect(lobby.queuedFor(person(1))).toBe(4);
    cleanUp(matches);
  });

  it('counts being removed for staying disconnected the same as walking out', () => {
    const { lobby, matches, struck } = lobbyWith(1_000);
    lobby.join(person(1), 3);
    lobby.join(person(2), 3);

    lobby.disconnected(person(1));
    jest.advanceTimersByTime(1_000);
    expect(struck.get(person(1))?.strikes).toBe(1);
    cleanUp(matches);
  });

  /** Everybody answers at once when it is their turn; every other clock runs (as in transcript.test). */
  async function playOut(match: Match, people: string[]) {
    const seats = new Map(people.map((id) => [match.view(id).youId, id]));
    for (let step = 0; step < 300; step += 1) {
      const room: Room = match.snapshot();
      if (room.outcome) return;
      const who = room.phase === 'answering' ? seats.get(currentTurnId(room) ?? '') : undefined;
      if (who) {
        match.handle(who, { type: 'answer', text: 'hi', timedOut: false, replyToId: null });
        continue;
      }
      await jest.advanceTimersByTimeAsync(5_000);
    }
  }

  it('does not strike leaving once the match is decided, and forgives a strike for finishing', async () => {
    const { lobby, matches, struck, penalties } = lobbyWith();
    penalties.strike(person(1));
    penalties.strike(person(1));

    // A two-person room: joining runs the cooldown check, so seat them first.
    jest.advanceTimersByTime(2 * MINUTE);
    lobby.join(person(1), 3);
    lobby.join(person(2), 3);
    const match = [...matches][0];
    await playOut(match, [person(1), person(2)]);
    expect(match.isOver()).toBe(true);

    const before = penalties.strikes(person(1));
    lobby.leaveMatch(person(1));
    expect(struck.has(person(1))).toBe(false);
    expect(penalties.strikes(person(1))).toBe(before - 1);
    cleanUp(matches);
  });

  it('does not strike somebody whose phone came back in time', () => {
    const { lobby, matches, struck } = lobbyWith(1_000);
    lobby.join(person(1), 3);
    lobby.join(person(2), 3);

    lobby.disconnected(person(1));
    jest.advanceTimersByTime(500);
    lobby.reconnected(person(1));
    jest.advanceTimersByTime(5_000);
    expect(struck.has(person(1))).toBe(false);
    cleanUp(matches);
  });
});
