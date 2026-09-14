/**
 * Who is waiting, who is playing, and in which match.
 *
 * STEP 1 VERSION, and it is honest about it. Real matchmaking is step 2. This
 * is the least that lets two phones land in the same room: everybody who asks
 * for a match joins one waiting list, and a match starts either the moment the
 * room is full of people or a short while after the first person arrived —
 * whichever comes first — with stand-ins filling whatever seats nobody took.
 *
 * The short wait is what makes testing possible with two devices. Without it a
 * five-seat room would sit waiting for four people forever.
 */

import { DEFAULT_SETTINGS } from '../../src/game/types';
import type { Matchmaking } from '../../src/game/transport';

import { Match, type ImpostorModel } from './match';

/**
 * How long the first person waits for company before the match starts with
 * whoever showed up. Long enough to pick up a second phone; short enough that
 * testing alone is not a chore. Overridable while testing.
 */
const WAIT_FOR_COMPANY_MS = Number(process.env.GAME_LOBBY_WAIT_MS ?? 10_000);

/** People per match. One seat is always the impostor, so it is never a person's. */
const PEOPLE_PER_MATCH = DEFAULT_SETTINGS.playerCount - 1;

export type LobbyEvents = {
  /** A match changed; send its people their views. */
  matchChanged: (match: Match) => void;
  /** The queue changed; tell the people in it where they stand. */
  queueChanged: (waiting: string[], progress: Matchmaking) => void;
  /** Somebody stopped being in the queue — matched, or gone. */
  leftQueue: (playerId: string) => void;
  /** A match is gone; whoever was still in it is no longer in a room. */
  matchEnded: (match: Match, playerIds: string[]) => void;
};

export class Lobby {
  private waiting: string[] = [];
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly byPlayer = new Map<string, Match>();

  constructor(
    private readonly model: ImpostorModel,
    private readonly events: LobbyEvents
  ) {}

  matchFor(playerId: string): Match | null {
    return this.byPlayer.get(playerId) ?? null;
  }

  isWaiting(playerId: string) {
    return this.waiting.includes(playerId);
  }

  progress(): Matchmaking {
    // Counts the stand-ins' seats as not yet found, so the number on the queue
    // screen only moves when a real person arrives.
    return { found: this.waiting.length, total: PEOPLE_PER_MATCH };
  }

  join(playerId: string) {
    // Already somewhere — the caller just re-sends what they are in.
    if (this.byPlayer.has(playerId) || this.waiting.includes(playerId)) return;

    this.waiting.push(playerId);

    if (this.waiting.length >= PEOPLE_PER_MATCH) {
      this.start();
      return;
    }

    if (!this.startTimer) {
      this.startTimer = setTimeout(() => this.start(), WAIT_FOR_COMPANY_MS);
    }
    this.events.queueChanged(this.waiting, this.progress());
  }

  /** Out of the queue without a match — cancelled, or the connection went. */
  cancel(playerId: string) {
    if (!this.waiting.includes(playerId)) return;
    this.waiting = this.waiting.filter((id) => id !== playerId);
    this.events.leftQueue(playerId);
    if (this.waiting.length === 0 && this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
    this.events.queueChanged(this.waiting, this.progress());
  }

  /** Walked out of their match. They are free to queue again straight away. */
  leaveMatch(playerId: string) {
    const match = this.byPlayer.get(playerId);
    if (!match) return;
    this.byPlayer.delete(playerId);
    match.leave(playerId);
  }

  private start() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = null;

    const people = this.waiting.splice(0, PEOPLE_PER_MATCH);
    if (people.length === 0) return;

    const match = new Match(
      people,
      this.model,
      (m) => this.events.matchChanged(m),
      (m) => {
        const stillIn = [...this.byPlayer].filter(([, x]) => x === m).map(([id]) => id);
        stillIn.forEach((id) => this.byPlayer.delete(id));
        this.events.matchEnded(m, stillIn);
      }
    );

    people.forEach((id) => {
      this.byPlayer.set(id, match);
      this.events.leftQueue(id);
    });
    // The constructor already announced the room, but before anyone was
    // registered against it — say it again now that they are.
    this.events.matchChanged(match);

    // Anyone left over starts the next wait.
    if (this.waiting.length > 0) {
      this.startTimer = setTimeout(() => this.start(), WAIT_FOR_COMPANY_MS);
      this.events.queueChanged(this.waiting, this.progress());
    }
  }
}
