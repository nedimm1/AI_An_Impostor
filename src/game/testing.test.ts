/**
 * The test harness's own two switches, checked the only way a build-time flag
 * can be: by building the module twice.
 *
 * `TEST_MODE` is inlined from the environment when the module is first
 * evaluated, so these reset the registry and set the variable before the
 * import rather than trying to toggle it afterwards — which would do nothing
 * and pass anyway, which is the kind of test worth not writing.
 */

import type { Player } from './types';

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

/** Seats a room with the flag set as given, in a fresh module registry. */
function seatWith(testMode: string | undefined) {
  let room;
  jest.isolateModules(() => {
    const previous = process.env.EXPO_PUBLIC_TEST_MODE;
    if (testMode === undefined) delete process.env.EXPO_PUBLIC_TEST_MODE;
    else process.env.EXPO_PUBLIC_TEST_MODE = testMode;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { roomReducer } = require('./reducer');
    room = roomReducer(null, {
      type: 'startMatch',
      id: 'rm_flag',
      yourId: 'you',
      strangers: strangers('Mara', 'Deniz', 'Kofi', 'Ines'),
    });

    if (previous === undefined) delete process.env.EXPO_PUBLIC_TEST_MODE;
    else process.env.EXPO_PUBLIC_TEST_MODE = previous;
  });
  return room!;
}

describe('test mode', () => {
  it('renames the impostor seat so you can see who it is', () => {
    const room = seatWith('1');
    const impostor = room.players.find((p: Player) => p.id === room.impostorId);
    expect(impostor?.name).toBe('AI');
  });

  it('leaves the seat alone when the flag is off', () => {
    const room = seatWith(undefined);
    const impostor = room.players.find((p: Player) => p.id === room.impostorId);
    expect(impostor?.name).toMatch(/^Mr\. /);
  });
});
