/**
 * How far this phone's clock is from the game server's.
 *
 * Every deadline in a room is a time on the server's clock, and a phone's clock
 * can be seconds away from it, so deadlines are moved onto the phone's clock
 * before anything counts down against them.
 *
 * The obvious way to measure the gap is wrong on a slow connection. The server
 * stamps each message with its `now`, and the phone compares that with the
 * time the message arrived — but "arrived" is "sent, plus however long it spent
 * on the way". On a connection with a second of lag, every deadline then looks
 * a second later than it really is: the timer on screen shows time you do not
 * have, and the answer the app sends when that timer runs out leaves late,
 * travels slowly, and reaches the server after the turn is already over.
 *
 * The travel time is never negative, so it can only ever make a message look
 * later, never earlier. That means the message that arrived *soonest* after
 * it was stamped is the one with the least travel mixed in, and its gap is the
 * closest to the real difference between the two clocks. So this keeps the
 * smallest gap it has seen — over a recent window rather than forever, because
 * a phone's clock can be corrected underneath it (a network time sync, somebody
 * changing the time) and an old reading would then be wrong.
 */

/** How long a reading is trusted for. */
const WINDOW_MS = 2 * 60_000;

/** Enough readings to ride out a bad patch; the server sends one every few seconds at least. */
const MAX_SAMPLES = 40;

export class ServerClock {
  private samples: { offset: number; at: number }[] = [];

  /** A message stamped with the server's `now` has just arrived. */
  observe(serverNow: number, receivedAt: number = Date.now()) {
    // A server that predates the stamp sends nothing here; guessing would move
    // every deadline by NaN.
    if (!Number.isFinite(serverNow)) return;
    this.samples.push({ offset: receivedAt - serverNow, at: receivedAt });
    const cutoff = receivedAt - WINDOW_MS;
    this.samples = this.samples.filter((s) => s.at >= cutoff).slice(-MAX_SAMPLES);
  }

  /**
   * Milliseconds to add to a server time to get the same moment on this phone.
   * Zero before anything has been heard, which assumes the clocks agree.
   */
  offset(): number {
    if (this.samples.length === 0) return 0;
    return Math.min(...this.samples.map((s) => s.offset));
  }

  /** A server time, on this phone's clock. */
  toLocal(serverTime: number | null): number | null {
    return serverTime === null ? null : serverTime + this.offset();
  }
}
