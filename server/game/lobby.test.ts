/**
 * The queue's rules, one at a time, on a fake clock.
 */

import type { Matchmaking } from '../rules/transport';
import type { RoomSize } from '../rules/types';

import { Lobby, type LobbyEvents } from './lobby';
import type { ImpostorModel, Match } from './match';

const quietModel: ImpostorModel = { answer: async () => null, vote: async () => null };

const person = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;

function lobbyWith() {
  const matches = new Set<Match>();
  const progress = new Map<string, Matchmaking>();

  const events: LobbyEvents = {
    matchChanged: (m) => matches.add(m),
    queueChanged: (waiting, p) => waiting.forEach((id) => progress.set(id, p)),
    leftQueue: (id) => progress.delete(id),
    matchEnded: (m) => matches.delete(m),
  };

  return { lobby: new Lobby(quietModel, events), matches, progress };
}

/** Walks every match's people out so its clocks stop. */
function cleanUp(matches: Set<Match>) {
  for (const m of [...matches]) m.players().forEach((id) => m.leave(id));
}

function joinAll(lobby: Lobby, size: RoomSize, ...ns: number[]) {
  ns.forEach((n) => lobby.join(person(n), size));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('choosing a room size', () => {
  it.each([
    { size: 3 as RoomSize, people: [1, 2] },
    { size: 4 as RoomSize, people: [1, 2, 3] },
    { size: 5 as RoomSize, people: [1, 2, 3, 4] },
  ])('starts a $size-seat room once enough people are in its queue', ({ size, people }) => {
    const { lobby, matches } = lobbyWith();
    joinAll(lobby, size, ...people);

    expect(matches.size).toBe(1);
    const room = [...matches][0].view(person(1));
    expect(room.players).toHaveLength(size);
    cleanUp(matches);
  });

  it('does not start a room one person short, however long it waits', () => {
    // A chosen size is a promise; there is no starting smaller on a timer.
    const { lobby, matches, progress } = lobbyWith();
    joinAll(lobby, 5, 1, 2, 3);

    expect(progress.get(person(1))).toEqual({ found: 3, total: 4 });
    jest.advanceTimersByTime(60 * 60_000);
    expect(matches.size).toBe(0);
  });

  it('keeps the sizes apart', () => {
    // Two people wanting a duel and two wanting a big room are not four
    // people for anything.
    const { lobby, matches, progress } = lobbyWith();
    lobby.join(person(1), 3);
    lobby.join(person(2), 5);
    lobby.join(person(3), 5);

    expect(matches.size).toBe(0);
    expect(progress.get(person(1))).toEqual({ found: 1, total: 2 });
    expect(progress.get(person(3))).toEqual({ found: 2, total: 4 });

    lobby.join(person(4), 3);
    expect(matches.size).toBe(1);
    expect([...matches][0].view(person(4)).players).toHaveLength(3);
    cleanUp(matches);
  });

  it('moves you to the new queue when you ask for a different size', () => {
    const { lobby } = lobbyWith();
    lobby.join(person(1), 5);
    lobby.join(person(1), 4);

    expect(lobby.queuedFor(person(1))).toBe(4);
    expect(lobby.progress(5)).toEqual({ found: 0, total: 4 });
  });

  it('does not count you twice when a reconnect asks for the same size again', () => {
    const { lobby } = lobbyWith();
    lobby.join(person(1), 5);
    lobby.join(person(1), 5);
    expect(lobby.progress(5)).toEqual({ found: 1, total: 4 });
  });

  it('takes you out of the queue when you cancel', () => {
    const { lobby, progress } = lobbyWith();
    joinAll(lobby, 4, 1, 2);
    lobby.cancel(person(1));

    expect(lobby.queuedFor(person(1))).toBeNull();
    expect(progress.get(person(2))).toEqual({ found: 1, total: 3 });
  });

  it('never makes a person the impostor', () => {
    const { lobby, matches } = lobbyWith();
    joinAll(lobby, 5, 1, 2, 3, 4);
    const [match] = [...matches];

    // Every person's own seat; whatever is left over is the impostor's.
    const room = match.view(person(1));
    const peopleSeats = [1, 2, 3, 4].map((n) => match.view(person(n)).youId);
    expect(room.players.filter((p) => !peopleSeats.includes(p.id))).toHaveLength(1);
    cleanUp(matches);
  });
});
