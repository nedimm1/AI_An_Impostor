/**
 * The match, written down.
 *
 * Online matches run here, which means this process is the only thing that
 * ever sees a whole room: every phone is sent a view with the answer taken out
 * (`view.ts`), and until now the server printed only the impostor's lines. So
 * the one question you actually want to ask after a bad round — *what was it
 * answering?* — had no record anywhere. Its line was in the terminal and the
 * four lines that provoked it were on four different emulators.
 *
 * This prints the room in order, as it happens, and keeps a structured copy of
 * every finished match so a hundred of them can be read back at once rather
 * than scrolled for.
 *
 *   server/logs/<started>-<id>.json   one file per match
 *   npm run transcripts              reads them back as transcripts
 *
 * ONE FILE PER MATCH, NOT ONE FILE. It was a single append-only `matches.jsonl`
 * and two records vanished out of the middle of it: the file was truncated in
 * place while the server had it open and was appending to it. A log you read in
 * an editor while a process writes to it is a log where one save drops
 * everything appended since the buffer loaded — and a record that can quietly
 * lose the match you were about to read is worse than no record, because you
 * believe what is left. A file per match cannot lose a match it does not
 * contain.
 *
 * IT IS A LOCAL DEBUGGING AID. It writes what people typed to a file in the
 * working tree — fine on your own machine while there are five players and all
 * of them are you, and the wrong shape entirely for anything with real players
 * in it. `GAME_LOG=off` turns it off; the directory is gitignored.
 *
 * THE SERVER'S TERMINAL IS NOT A SEAT. It marks the impostor with `*` and
 * prints the room before the reveal, because the operator already holds the
 * key and the process that decides the match. Nothing here is sent anywhere.
 */

import fs from 'node:fs';
import path from 'node:path';

import { playerById, type Answer, type Ballot, type Room } from '../../src/game/types';

import type { Match } from './match';

/*
 * Read when they are used rather than when this file loads.
 *
 * Config that is captured at import time cannot be changed by anything that
 * imports the file — which is every test, and the reason this was worth a
 * second pass. It is three environment reads per match, and it means the
 * switches below work from wherever they are set.
 */

/** Off entirely, for when the terminal is being used for something else. */
const enabled = () => process.env.GAME_LOG !== 'off';

/** Printing can be dropped on its own — the file is the part worth keeping. */
const printing = () => enabled() && process.env.GAME_LOG !== 'quiet';

const logDir = () => process.env.GAME_LOG_DIR ?? path.join(__dirname, '..', 'logs');

/**
 * `2026-09-18T17-29-38-rm_puehh5c.json` — sorts chronologically, says which
 * match it is, and contains characters every filesystem will take.
 */
function logFile(startedAt: number, matchId: string) {
  const when = new Date(startedAt).toISOString().replace(/[:.]/g, '-').replace(/-\d{3}Z$/, '');
  return path.join(logDir(), `${when}-${matchId}.json`);
}

/** Longest seat name is `Mr. Orange`; keeps the text in one column. */
const NAME_WIDTH = 10;

/**
 * What the model did on one turn, as only `index.js` can see it.
 *
 * The match is handed a plain `answer(turn) => string | null` on purpose, so it
 * can be tested without a network and so cost accounting stays in one file. The
 * shape the impostor was drawn to write, and how long it took, are therefore
 * known at the call and nowhere near the line when it lands in the room. They
 * are posted here instead.
 *
 * MATCHED BY ORDER, WHICH IS ALMOST ALWAYS RIGHT. A note is attached to the
 * impostor's next line in the room. That is exact whenever the model answers
 * inside its own turn, which is the normal case — the line then waits out a
 * typing delay before it is sent. A call that overruns the turn deadline
 * resolves after the room has already moved on; its note is kept, printed on
 * its own as `late`, and never attached to somebody else's turn.
 */
export type ImpostorNote = {
  /** How long the model took, ms. */
  ms: number;
  /** What it was drawn to do — see `shapeNote` in `impostor.js`. */
  shape: Record<string, unknown> | null;
  /** The call failed or came back empty; the room got a stock line. */
  fellBack: boolean;
  /** Epoch ms the call came back. Used only to spot a late one. */
  at: number;
  /** What this one call cost, in dollars. */
  cost: number;
};

/** Room id → notes from the model, oldest first, not yet attached to a line. */
const pending = new Map<string, ImpostorNote[]>();

/**
 * The model answered for this room. Called from `index.js`, which is the only
 * place that has both the result and the accounting.
 */
export function noteImpostorCall(roomId: string | undefined, note: ImpostorNote) {
  if (!enabled() || !roomId) return;
  const queue = pending.get(roomId);
  if (queue) queue.push(note);
  else pending.set(roomId, [note]);
}

function say(line: string) {
  if (printing()) console.log(line);
}

/** `Mr. Pink`, padded, with a star when the seat is the impostor. */
function seatLabel(room: Room, playerId: string) {
  const name = playerById(room, playerId)?.name ?? 'someone';
  const mark = playerId === room.impostorId ? '*' : ' ';
  return `${name.padEnd(NAME_WIDTH)}${mark}`;
}

/** The interesting half of a shape, in one line. Mirrors what `/answer` prints. */
function drawnAs(shape: Record<string, unknown> | null) {
  if (!shape) return '';
  return [
    shape.bit ? `BIT=${shape.bit}` : null,
    shape.pushback ? `pushback=${shape.pushback}` : null,
    shape.stance ? `stance=${shape.stance}` : null,
    shape.nameUse ? `names=${shape.nameUse}` : null,
    shape.renamed ? 'ASKED AGAIN' : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** One line of a match, as it is kept on disk. */
type LoggedLine = {
  round: number;
  /** Written during a tiebreaker rather than in the round proper. */
  tiebreaker: boolean;
  name: string;
  impostor: boolean;
  /** `answer`, or `departure` when somebody left rather than spoke. */
  kind: Answer['kind'];
  /**
   * Why they went, on a departure: `left` for walking out, `disconnected` for
   * a connection that did not come back. Absent on an answer.
   *
   * Carried because a departure's `text` is empty and the reason is the whole
   * content of the line. "Walked out immediately after being caught" is the
   * most useful thing in a transcript and it was being written down as `──`.
   */
  departedBecause?: string;
  text: string;
  /** The seat this was written at, by name, or null when it stands alone. */
  replyTo: string | null;
  timedOut: boolean;
  lostConnection: boolean;
  at: number;
  /** Present on the impostor's lines: what the model was drawn to write. */
  model?: Omit<ImpostorNote, 'at'>;
};

/** One finished match, as it is kept on disk. */
type LoggedMatch = {
  matchId: string;
  startedAt: string;
  endedAt: string;
  /** `humans` = it was voted out; `impostor` = it outlasted them; null = abandoned. */
  outcome: Room['outcome'];
  /**
   * How the match actually ended.
   *
   * `vote` is the game being played to its end. `walkout` is the room emptying
   * — people leaving or losing their connection until there was nobody left to
   * vote — which the rules score as an impostor win because there is nothing
   * else they could score it as, but which is not the impostor having got away
   * with anything. The first match this logger ever recorded was one: it
   * contradicted itself, two players asked it the same obvious question and
   * both left, and it was credited with a win.
   *
   * Kept separate from `outcome` because the rules are right and the statistic
   * is what was wrong. Anything counting how often it fools a room reads this.
   */
  decidedBy: 'vote' | 'walkout' | null;
  /** People who were voted out, and people who left. The evidence for the above. */
  humansVotedOut: number;
  humansWalkedOut: number;
  impostor: string | null;
  rounds: number;
  seats: { name: string; human: boolean; impostor: boolean }[];
  prompts: { round: number; tiebreaker: boolean; prompt: string }[];
  lines: LoggedLine[];
  ballots: {
    round: number;
    votes: { voter: string; target: string }[];
    eliminated: string | null;
    tied: string[] | null;
  }[];
  /** Calls that came back after the room had moved on. See `ImpostorNote`. */
  lateModelCalls: Omit<ImpostorNote, 'at'>[];
};

/**
 * One match being followed. Everything it knows comes from re-reading the room
 * after each change and taking what it has not taken before — so it cannot get
 * out of step with the match, and it holds nothing the match does not.
 */
class MatchTranscript {
  private readonly startedAt = Date.now();
  private linesSeen = 0;
  private ballotsSeen = 0;
  private lastPrompt: string | null = null;
  private written = false;

  private readonly prompts: LoggedMatch['prompts'] = [];
  private readonly lines: LoggedLine[] = [];
  private readonly ballots: LoggedMatch['ballots'] = [];
  private readonly lateModelCalls: Omit<ImpostorNote, 'at'>[] = [];

  constructor(private readonly match: Match) {
    const room = match.snapshot();
    say(`\n  ┌─ match ${room.id.slice(0, 8)} — ${room.players.length} seats\n`);
  }

  /** Read the room, print whatever is new, and keep it. */
  sync() {
    const room = this.match.snapshot();

    // The reducer swaps in the tiebreaker's own wording, so a changed prompt is
    // the one signal that covers a new round and a tiebreaker both.
    if (room.prompt !== this.lastPrompt && room.prompt) {
      this.lastPrompt = room.prompt;
      const tiebreaker = room.tiebreaker !== null;
      this.prompts.push({ round: room.round, tiebreaker, prompt: room.prompt });
      say(
        `\n  ── ${tiebreaker ? 'tiebreaker' : `round ${room.round}`} ─ ${room.prompt}\n`
      );
    }

    for (const entry of room.transcript.slice(this.linesSeen)) this.line(room, entry);
    this.linesSeen = room.transcript.length;

    for (const ballot of room.ballots.slice(this.ballotsSeen)) this.ballot(room, ballot);
    this.ballotsSeen = room.ballots.length;

    // Written the moment the match is decided rather than when it is disposed,
    // which is five minutes later and may never happen if the server is killed.
    if (room.outcome && !this.written) this.write(room);
  }

  /** One line landing in the room. */
  private line(room: Room, entry: Answer) {
    const name = playerById(room, entry.playerId)?.name ?? 'someone';
    const impostor = entry.playerId === room.impostorId;
    const replyTo = playerById(
      room,
      room.transcript.find((a) => a.id === entry.replyToId)?.playerId
    );

    const note = impostor && entry.kind === 'answer' ? this.takeNote(room.id) : null;

    const logged: LoggedLine = {
      round: entry.round,
      tiebreaker: entry.inTiebreaker,
      name,
      impostor,
      kind: entry.kind,
      ...(entry.departedBecause ? { departedBecause: entry.departedBecause } : {}),
      text: entry.text,
      replyTo: replyTo?.name ?? null,
      timedOut: entry.timedOut,
      lostConnection: entry.lostConnection ?? false,
      at: entry.createdAt,
    };
    if (note) {
      const { at: _at, ...rest } = note;
      logged.model = rest;
    }
    this.lines.push(logged);

    if (entry.kind === 'departure') {
      const why =
        entry.departedBecause === 'disconnected' ? 'lost their connection' : 'walked out';
      say(`  ${entry.round}  ${seatLabel(room, entry.playerId)} ── ${entry.text || why}`);
      return;
    }

    const said = entry.timedOut
      ? entry.lostConnection
        ? '(connection went, nothing typed)'
        : '(ran out of time)'
      : entry.text;
    const aimed = replyTo ? `@${replyTo.name} ` : '';
    const cut = entry.lostConnection && !entry.timedOut ? '  (sent for them)' : '';

    say(`  ${entry.round}  ${seatLabel(room, entry.playerId)} ${aimed}${said}${cut}`);

    if (note) {
      const drawn = drawnAs(note.shape);
      const how = note.fellBack ? 'stock line' : `${(note.ms / 1000).toFixed(1)}s`;
      say(`     ${' '.repeat(NAME_WIDTH)}  ↳ ${how}${drawn ? `  ${drawn}` : ''}`);
    }
  }

  /** A ballot's result, once the room has been shown it. */
  private ballot(room: Room, ballot: Ballot) {
    const nameOf = (id: string) => playerById(room, id)?.name ?? 'someone';

    const votes = Object.entries(ballot.votes).map(([voter, target]) => ({
      voter: nameOf(voter),
      target: nameOf(target),
    }));
    const eliminated = ballot.eliminatedId ? nameOf(ballot.eliminatedId) : null;
    const tied = ballot.tied ? ballot.tied.map(nameOf) : null;

    this.ballots.push({ round: ballot.round, votes, eliminated, tied });

    const cast = votes.map((v) => `${v.voter} → ${v.target}`).join('   ') || 'nobody voted';
    const outcome = eliminated
      ? `${eliminated} out${eliminated === nameOf(room.impostorId ?? '') ? '  ← the impostor' : ''}`
      : tied
        ? `tied: ${tied.join(' / ')}`
        : 'nobody out';

    say(`\n  ── vote ─ ${cast}\n  ──        ⇒ ${outcome}\n`);
  }

  /**
   * The oldest note that has not been attached to a line, unless it came back
   * after the line it would be attached to had already landed — see
   * `ImpostorNote`.
   */
  private takeNote(roomId: string): ImpostorNote | null {
    const queue = pending.get(roomId);
    if (!queue || queue.length === 0) return null;

    // Anything still queued behind the one being taken overran its turn.
    const note = queue.shift()!;
    while (queue.length > 0) {
      const { at: _at, ...rest } = queue.shift()!;
      this.lateModelCalls.push(rest);
      say(`     ${' '.repeat(NAME_WIDTH)}  ↳ late model call, discarded by the room`);
    }
    return note;
  }

  /** The match, on disk. Called once — at the reveal, or when it is abandoned. */
  private write(room: Room) {
    if (this.written) return;
    this.written = true;

    const impostor = playerById(room, room.impostorId)?.name ?? null;

    /*
     * A seat that is out is either voted out or gone. `eliminated` is the
     * ballot; `connected: false` without it is somebody who left or dropped.
     */
    const humans = room.players.filter((p) => p.id !== room.impostorId);
    const humansVotedOut = humans.filter((p) => p.eliminated).length;
    const humansWalkedOut = humans.filter((p) => !p.eliminated && !p.connected).length;

    /*
     * Any walkout makes the win unearned, even a match that also had a ballot:
     * a room it talked its way past does not lose people to the exit. Being
     * voted out is always the room deciding, so `humans` is always a vote.
     */
    const decidedBy: LoggedMatch['decidedBy'] = !room.outcome
      ? null
      : room.outcome === 'humans'
        ? 'vote'
        : humansWalkedOut > 0
          ? 'walkout'
          : 'vote';

    const record: LoggedMatch = {
      matchId: room.id,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date().toISOString(),
      outcome: room.outcome,
      decidedBy,
      humansVotedOut,
      humansWalkedOut,
      impostor,
      rounds: room.round,
      seats: room.players.map((p) => ({
        name: p.name,
        human: this.match.isHumanSeat(p.id),
        impostor: p.id === room.impostorId,
      })),
      prompts: this.prompts,
      lines: this.lines,
      ballots: this.ballots,
      lateModelCalls: this.lateModelCalls,
    };

    if (room.outcome) {
      const how =
        decidedBy === 'walkout'
          ? ' by the room emptying, not by surviving a vote'
          : '';
      say(
        `\n  └─ ${room.outcome === 'humans' ? 'the room won' : 'the impostor won'}${how}` +
          ` — it was ${impostor ?? 'nobody'}, after ${room.round} round${room.round === 1 ? '' : 's'}\n`
      );
    } else {
      say(`\n  └─ match ${room.id.slice(0, 8)} abandoned, ${this.lines.length} lines\n`);
    }

    try {
      fs.mkdirSync(logDir(), { recursive: true });
      // `wx` — a match is written once and never reopened, so a path that
      // already exists means something else is in it and this is not the file.
      fs.writeFileSync(logFile(this.startedAt, room.id), JSON.stringify(record, null, 1), {
        flag: 'wx',
      });
    } catch (error) {
      // A log that can fail a match is worse than no log.
      console.error(`  transcript not written: ${(error as Error).message}`);
    }
  }

  /** The match is gone. Keep whatever was never decided, then let go. */
  finish() {
    this.sync();
    if (!this.written) this.write(this.match.snapshot());
    pending.delete(this.match.id);
  }
}

/**
 * Every match being followed. One of these lives in `socket.ts`, alongside the
 * lobby whose events drive it.
 */
export class Logbook {
  private readonly open = new Map<string, MatchTranscript>();

  /** A match changed. Starts following it the first time it is seen. */
  sync(match: Match) {
    if (!enabled()) return;
    let transcript = this.open.get(match.id);
    if (!transcript) {
      transcript = new MatchTranscript(match);
      this.open.set(match.id, transcript);
    }
    transcript.sync();
  }

  /** A match is over and nobody needs it any more. */
  finish(match: Match) {
    if (!enabled()) return;
    this.open.get(match.id)?.finish();
    this.open.delete(match.id);
  }
}

/** Where the records go, for the banner on startup. Null when it is off. */
export function transcriptPath() {
  return enabled() ? logDir() : null;
}
