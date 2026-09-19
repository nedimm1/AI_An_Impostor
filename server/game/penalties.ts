/**
 * What leaving a match early costs you.
 *
 * Every departure from a match that is still being played is a strike —
 * walking out and being removed for staying disconnected alike, because to the
 * people left in the room they are the same thing: a seat that stopped playing.
 * Strikes buy a wait before you can queue again, and the wait climbs:
 *
 *   1st strike   a warning, nothing else
 *   2nd          2 minutes
 *   3rd          10 minutes
 *   4th and on   30 minutes
 *
 * Strikes are forgiven two ways: each one lapses a day after it was earned, and
 * every match you stay in until the reveal wipes the oldest one. Somebody whose
 * phone died once is back to a clean record by the end of their next game;
 * somebody who walks out of every room they do not like never gets there.
 *
 * NOT COUNTED — nobody is left waiting on you: leaving once the match is
 * decided, leaving after you were voted out (you were only watching), and
 * leaving when you are the last person still in the room. Those are decided
 * by the match (`Match.leavingCosts`), not here.
 *
 * WHAT IT CANNOT STOP: a player is whatever id their phone generated, so
 * reinstalling the app is a fresh record. Fine for now; an account is the fix.
 *
 * The record is kept in a JSON file so a restart or a redeploy does not forgive
 * everybody. On a container that file needs a volume, or it goes with the
 * container (`GAME_PENALTIES_FILE`).
 */

import fs from 'node:fs';
import path from 'node:path';

/** The wait each strike buys, in order. The last one repeats. */
export const COOLDOWN_LADDER_MS = [0, 2 * 60_000, 10 * 60_000, 30 * 60_000];

/** How long a strike counts before it lapses on its own. */
export const STRIKE_LIFETIME_MS = 24 * 60 * 60_000;

/** How long after the last change the file is written — one write per burst. */
const SAVE_DELAY_MS = 1_000;

type PlayerRecord = {
  /** When each live strike was earned, oldest first. */
  strikes: number[];
  /** No queueing before this (server clock), or 0. */
  until: number;
};

export type Strike = {
  /** Live strikes, this one included. */
  strikes: number;
  /** The wait it earned. 0 on a first strike, which is only a warning. */
  cooldownMs: number;
};

export class Penalties {
  private readonly records = new Map<string, PlayerRecord>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** Where the record is kept, or null to keep it in memory only (tests). */
    private readonly file: string | null = null,
    private readonly now: () => number = () => Date.now()
  ) {
    this.load();
  }

  /** Left a match that was still being played. */
  strike(playerId: string): Strike {
    const record = this.live(playerId) ?? { strikes: [], until: 0 };
    const now = this.now();

    record.strikes.push(now);
    const step = Math.min(record.strikes.length, COOLDOWN_LADDER_MS.length) - 1;
    const cooldownMs = COOLDOWN_LADDER_MS[step];
    record.until = Math.max(record.until, now + cooldownMs);

    this.records.set(playerId, record);
    this.changed();
    return { strikes: record.strikes.length, cooldownMs };
  }

  /** Stayed until the reveal. Takes the oldest strike off. */
  completed(playerId: string) {
    const record = this.live(playerId);
    if (!record || record.strikes.length === 0) return;
    record.strikes.shift();
    this.tidy(playerId, record);
    this.changed();
  }

  /** How long until this player may queue again, in ms. 0 when they may now. */
  cooldownLeft(playerId: string): number {
    const record = this.live(playerId);
    return record ? Math.max(0, record.until - this.now()) : 0;
  }

  /** Live strikes, for tests and logs. */
  strikes(playerId: string): number {
    return this.live(playerId)?.strikes.length ?? 0;
  }

  /** The record with lapsed strikes dropped, or undefined when nothing is left. */
  private live(playerId: string): PlayerRecord | undefined {
    const record = this.records.get(playerId);
    if (!record) return undefined;
    const cutoff = this.now() - STRIKE_LIFETIME_MS;
    record.strikes = record.strikes.filter((at) => at > cutoff);
    return this.tidy(playerId, record);
  }

  private tidy(playerId: string, record: PlayerRecord) {
    if (record.strikes.length === 0 && record.until <= this.now()) {
      this.records.delete(playerId);
      return undefined;
    }
    return record;
  }

  private load() {
    if (!this.file) return;
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Record<string, PlayerRecord>;
      for (const [playerId, record] of Object.entries(saved)) {
        if (Array.isArray(record?.strikes) && typeof record.until === 'number') {
          this.records.set(playerId, { strikes: record.strikes, until: record.until });
        }
      }
    } catch {
      // No file yet, or an unreadable one: start clean rather than refuse to run.
    }
  }

  private changed() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DELAY_MS);
  }

  /** Written to a temporary file and moved into place, so a crash mid-write cannot leave half a file. */
  save() {
    if (!this.file) return;
    const out: Record<string, PlayerRecord> = {};
    for (const playerId of [...this.records.keys()]) {
      const record = this.live(playerId);
      if (record) out[playerId] = record;
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(out));
    fs.renameSync(temporary, this.file);
  }
}
