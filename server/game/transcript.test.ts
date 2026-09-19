/**
 * The server's record of a match: what it prints, and what it keeps.
 *
 * The thing worth testing here is not the formatting — it is that the record is
 * a record *of the room*, taken by re-reading it rather than by being told.
 * A logger that has to be notified is a logger that silently misses whatever
 * nobody remembered to notify it about, and a transcript with a hole in it is
 * worse than none: you read it, believe it, and tune the impostor against a
 * round that did not happen that way.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { currentTurnId, type Room } from '../../src/game/types';

import { Lobby, type LobbyEvents } from './lobby';
import type { Match, ImpostorModel } from './match';
import { Logbook, noteImpostorCall } from './transcript';

const person = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;

/** What the model says, so its lines can be found in the record by sight. */
const MODEL_LINE = 'the impostor said this';

let tmp: string;

beforeEach(() => {
  jest.useFakeTimers();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'impostor-transcript-'));
  process.env.GAME_LOG_DIR = tmp;
  // Written, not printed: the record is what is under test, and 343 other
  // tests share this terminal.
  process.env.GAME_LOG = 'quiet';
});

afterEach(() => {
  jest.useRealTimers();
  delete process.env.GAME_LOG_DIR;
  delete process.env.GAME_LOG;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** The records written so far, oldest first. One file per match. */
function written() {
  if (!fs.existsSync(tmp)) return [];
  return fs
    .readdirSync(tmp)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(fs.readFileSync(path.join(tmp, name), 'utf8')));
}

/**
 * Two people and the impostor, with the record wired in exactly as `socket.ts`
 * wires it — off the lobby's events, so anything the lobby does not announce is
 * missing from the test too.
 */
function duel(model: ImpostorModel) {
  const logbook = new Logbook();
  const matches = new Set<Match>();

  const events: LobbyEvents = {
    matchChanged: (m) => {
      matches.add(m);
      logbook.sync(m);
    },
    queueChanged: () => {},
    leftQueue: () => {},
    matchEnded: (m) => {
      logbook.finish(m);
      matches.delete(m);
    },
  };

  const lobby = new Lobby(model, events);
  lobby.join(person(1), 3);
  lobby.join(person(2), 3);

  return { lobby, logbook, match: [...matches][0], people: [person(1), person(2)] };
}

/** That person's seat id in the room, which is all the match knows them by. */
const seatOf = (match: Match, playerId: string) => match.view(playerId).youId;

/**
 * Play it out. People answer the moment it is their turn; every other clock is
 * run forward. Async because the impostor's turn is a promise that has to
 * settle before its timer is even set.
 */
async function playOut(match: Match, people: string[]) {
  const seats = new Map(people.map((id) => [seatOf(match, id), id]));

  for (let step = 0; step < 300; step += 1) {
    const room: Room = match.snapshot();
    if (room.outcome) return;

    if (room.phase === 'answering') {
      const who = seats.get(currentTurnId(room) ?? '');
      if (who) {
        match.handle(who, {
          type: 'answer',
          text: `${room.players.find((p) => p.id === currentTurnId(room))?.name} on round ${room.round}`,
          timedOut: false,
          replyToId: null,
        });
        continue;
      }
    }

    // Nobody's turn to take, or the impostor's — let the clocks run.
    await jest.advanceTimersByTimeAsync(5_000);
  }
}

describe('the match record', () => {
  it('keeps every line of the room, marking the one seat that is not a person', async () => {
    const model: ImpostorModel = {
      answer: async () => MODEL_LINE,
      vote: async () => null,
    };
    const { match, people } = duel(model);
    await playOut(match, people);

    const [record] = written();
    expect(record).toBeDefined();
    expect(record.matchId).toBe(match.snapshot().id);
    expect(record.outcome === 'humans' || record.outcome === 'impostor').toBe(true);

    // Three seats, exactly one of which is not a person, and it is the one
    // named as the impostor.
    expect(record.seats).toHaveLength(3);
    const notPeople = record.seats.filter((s: { human: boolean }) => !s.human);
    expect(notPeople).toHaveLength(1);
    expect(notPeople[0].name).toBe(record.impostor);
    expect(notPeople[0].impostor).toBe(true);

    // What the people typed is in there, attributed.
    const mine = record.lines.filter((l: { impostor: boolean }) => !l.impostor);
    expect(mine.length).toBeGreaterThan(0);
    for (const line of mine) {
      expect(record.seats.map((s: { name: string }) => s.name)).toContain(line.name);
    }

    // And every ballot the room was shown.
    expect(record.ballots.length).toBeGreaterThan(0);
    for (const ballot of record.ballots) {
      for (const vote of ballot.votes) {
        expect(record.seats.map((s: { name: string }) => s.name)).toContain(vote.voter);
      }
    }
  });

  it('attaches what the model was drawn to write to the line it wrote', async () => {
    // `noteImpostorCall` here stands in for `index.js`, which is the only
    // place that has both the result of the call and the room it was for.
    const model: ImpostorModel = {
      answer: async (turn) => {
        noteImpostorCall(turn.roomId, {
          ms: 1_234,
          shape: { bit: 'none', stance: 'agree', pushback: null, nameUse: 'one' },
          fellBack: false,
          at: Date.now(),
          cost: 0.0004,
        });
        return MODEL_LINE;
      },
      vote: async () => null,
    };

    const { match, people } = duel(model);
    await playOut(match, people);

    const [record] = written();
    const spoken = record.lines.filter(
      (l: { impostor: boolean; timedOut: boolean }) => l.impostor && !l.timedOut
    );
    expect(spoken.length).toBeGreaterThan(0);

    const noted = spoken.find((l: { model?: unknown }) => l.model);
    expect(noted).toBeDefined();
    expect(noted.text).toBe(MODEL_LINE);
    expect(noted.model.shape.stance).toBe('agree');
    expect(noted.model.ms).toBe(1_234);
    expect(noted.model.fellBack).toBe(false);
  });

  it('writes the match when it is decided, not when it is finally disposed of', async () => {
    const model: ImpostorModel = { answer: async () => MODEL_LINE, vote: async () => null };
    const { match, people } = duel(model);
    await playOut(match, people);

    // The reveal is up and the match is still in memory for people to read it.
    expect(match.isOver()).toBe(true);
    expect(written()).toHaveLength(1);
  });

  it('records walking out as a line of the room, and keeps the match', async () => {
    const model: ImpostorModel = { answer: async () => MODEL_LINE, vote: async () => null };
    const { lobby, match, people } = duel(model);

    // Nobody plays it out — they leave partway through the first round.
    await jest.advanceTimersByTimeAsync(5_000);
    people.forEach((id) => lobby.leaveMatch(id));

    const [record] = written();
    expect(record).toBeDefined();
    expect(record.matchId).toBe(match.snapshot().id);

    // Departures sit in the transcript alongside answers, because somebody
    // walking out mid-round is part of the case against them.
    const left = record.lines.filter((l: { kind: string }) => l.kind === 'departure');
    expect(left.length).toBeGreaterThan(0);
    expect(left.every((l: { impostor: boolean }) => !l.impostor)).toBe(true);

    // A room with nobody left in it is a room the impostor outlasted, and the
    // record says so rather than trailing off.
    expect(record.outcome).toBe('impostor');

    // But not a win it earned. The rules have to score an empty room to
    // somebody; anything counting how often it fools a room must not read
    // this as one of those.
    expect(record.decidedBy).toBe('walkout');
    expect(record.humansWalkedOut).toBeGreaterThan(0);
    expect(record.humansVotedOut).toBe(0);

    // The reason is the whole content of a departure — its `text` is empty.
    expect(left.every((l: { departedBecause?: string }) => l.departedBecause === 'left')).toBe(
      true
    );
  });

  it('calls a match played out to a vote what it is', async () => {
    const model: ImpostorModel = { answer: async () => MODEL_LINE, vote: async () => null };
    const { match, people } = duel(model);
    await playOut(match, people);

    const [record] = written();
    expect(record.decidedBy).toBe('vote');
    expect(record.humansWalkedOut).toBe(0);
    expect(record.humansVotedOut).toBeGreaterThan(0);
  });

  it('gives each match its own file, so one cannot take another with it', async () => {
    const model: ImpostorModel = { answer: async () => MODEL_LINE, vote: async () => null };

    const first = duel(model);
    await playOut(first.match, first.people);
    const second = duel(model);
    await playOut(second.match, second.people);

    const files = fs.readdirSync(tmp).filter((name) => name.endsWith('.json'));
    expect(files).toHaveLength(2);
    expect(new Set(written().map((r) => r.matchId)).size).toBe(2);
  });

  it('writes nothing at all when it is turned off', async () => {
    process.env.GAME_LOG = 'off';

    const model: ImpostorModel = { answer: async () => MODEL_LINE, vote: async () => null };
    const { match, people } = duel(model);
    await playOut(match, people);

    expect(written()).toHaveLength(0);
  });
});
