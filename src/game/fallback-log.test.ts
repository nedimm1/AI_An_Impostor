/**
 * Marking the lines the model never wrote.
 *
 * Two rounds of play were spent judging Gemma on `mock.ts` filler, because a
 * dead server and a working one look identical from inside the room. The game
 * still cannot tell them apart — that is deliberate — but the log must.
 */

import { fallbackFor, noteImpostorFailure, noteImpostorFallback } from './round-log';

describe('stock lines are marked with the reason', () => {
  beforeEach(() => noteImpostorFailure(null));

  test('a failure binds its reason to the line that stood in for it', () => {
    noteImpostorFailure('server unreachable');
    noteImpostorFallback('I changed my mind twice while typing this');

    expect(fallbackFor('I changed my mind twice while typing this')).toBe('server unreachable');
  });

  test("a line the model actually wrote is not marked", () => {
    expect(fallbackFor('toast with nutella, though crisps are a solid shout')).toBeNull();
  });

  test('the reason is consumed, so the next line is not mislabelled', () => {
    noteImpostorFailure('model failed upstream');
    noteImpostorFallback('first stock line');
    // No new failure. A second stock line has no reason to claim.
    noteImpostorFallback('second stock line');

    expect(fallbackFor('first stock line')).toBe('model failed upstream');
    expect(fallbackFor('second stock line')).toBeNull();
  });

  test('a stale reason cleared at request time cannot leak into a later turn', () => {
    noteImpostorFailure('too slow — deadline passed');
    // The turn is cancelled before binding; the next request clears it.
    noteImpostorFailure(null);
    noteImpostorFallback('a later stock line');

    expect(fallbackFor('a later stock line')).toBeNull();
  });

  test('whitespace does not stop a line matching its reason', () => {
    noteImpostorFailure('proxy said 404');
    noteImpostorFallback('  padded line  ');

    expect(fallbackFor('padded line')).toBe('proxy said 404');
  });
});
