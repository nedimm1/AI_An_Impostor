import { ServerClock } from './clock';

/**
 * The phone's clock runs 3 seconds ahead of the server's in every test here, so
 * the right answer is always an offset of 3000ms. What varies is how long each
 * message spent travelling, which is what used to leak into the answer.
 */
const AHEAD = 3_000;

/** A message stamped at `serverNow` that took `lagMs` to arrive. */
function arrive(clock: ServerClock, serverNow: number, lagMs: number) {
  clock.observe(serverNow, serverNow + AHEAD + lagMs);
}

describe('the server clock', () => {
  it('assumes the clocks agree before it has heard anything', () => {
    expect(new ServerClock().offset()).toBe(0);
  });

  it('is only as wrong as the fastest message, not the slowest', () => {
    const clock = new ServerClock();
    const t = 1_000_000;
    arrive(clock, t, 1_200);
    arrive(clock, t + 1_000, 900);
    arrive(clock, t + 2_000, 40);
    arrive(clock, t + 3_000, 1_500);

    // 40ms off, where trusting each message as it came would have been off by
    // anything up to a second and a half.
    expect(clock.offset()).toBe(AHEAD + 40);
  });

  it('does not let a slow connection push deadlines later than they are', () => {
    // The bug: a second of lag made every deadline look a second later, so the
    // timer showed time the player did not have.
    const clock = new ServerClock();
    const t = 2_000_000;
    arrive(clock, t, 20);
    arrive(clock, t + 15_000, 1_000);

    const serverDeadline = t + 40_000;
    expect(clock.toLocal(serverDeadline)).toBe(serverDeadline + AHEAD + 20);
  });

  it('forgets old readings, in case the phone’s clock is corrected underneath it', () => {
    const clock = new ServerClock();
    const t = 3_000_000;
    arrive(clock, t, 10);
    // Three minutes later the phone's clock has been synced back by two
    // seconds; every new reading is off by one second, not three.
    for (let i = 1; i <= 12; i++) {
      const serverNow = t + 180_000 + i * 15_000;
      clock.observe(serverNow, serverNow + 1_000 + 30);
    }
    expect(clock.offset()).toBe(1_030);
  });

  it('ignores a message without a usable stamp', () => {
    const clock = new ServerClock();
    clock.observe(Number.NaN, 5_000);
    expect(clock.offset()).toBe(0);
    expect(clock.toLocal(null)).toBeNull();
  });
});
