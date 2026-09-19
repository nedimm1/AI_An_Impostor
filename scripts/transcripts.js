#!/usr/bin/env node

/**
 * Matches you have already played, read back.
 *
 * The game server keeps a record of every online match it runs
 * (`server/game/transcript.ts`) — one JSON file per match under
 * `server/logs/`. Those are for keeping, not for reading. This turns them back
 * into rooms you can read, and answers the two questions you actually have
 * after an evening of play: how often did it get away with it, and which of
 * its lines gave it away.
 *
 *   npm run transcripts                 the last 3 matches, in full
 *   npm run transcripts -- --last 10    the last 10
 *   npm run transcripts -- --lost       only the ones it lost
 *   npm run transcripts -- --impostor   only its own lines, across every match
 *   npm run transcripts -- --stats      no transcripts, just the tally
 *   npm run transcripts -- --id 3f2a    one match, by the start of its id
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR =
  process.env.GAME_LOG_DIR ?? path.join(__dirname, '..', 'server', 'logs');

/** The one-file-per-match layout replaced this; anything already in it still reads. */
const LEGACY_FILE = path.join(LOG_DIR, 'matches.jsonl');

const NAME_WIDTH = 10;

function parseArgs(argv) {
  const args = { last: 3, lost: false, won: false, impostor: false, stats: false, id: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--last') args.last = Number(argv[++i]) || 3;
    else if (flag === '--lost') args.lost = true;
    else if (flag === '--won') args.won = true;
    else if (flag === '--impostor') args.impostor = true;
    else if (flag === '--stats') args.stats = true;
    else if (flag === '--id') args.id = argv[++i] ?? null;
    else if (flag === '--all') args.last = Infinity;
  }
  return args;
}

function read() {
  const matches = [];

  // One file per match, newest last. The name starts with the start time, so
  // sorting the names sorts the evening.
  const files = fs.existsSync(LOG_DIR)
    ? fs
        .readdirSync(LOG_DIR)
        .filter((name) => name.endsWith('.json'))
        .sort()
    : [];

  for (const name of files) {
    try {
      matches.push(JSON.parse(fs.readFileSync(path.join(LOG_DIR, name), 'utf8')));
    } catch {
      // A file written by a server that was killed mid-write. Every other
      // match is untouched, which is the reason they are separate files.
      console.error(`  (skipped ${name} — not readable)`);
    }
  }

  // Whatever is left in the old shared append-only file.
  if (fs.existsSync(LEGACY_FILE)) {
    for (const line of fs.readFileSync(LEGACY_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        matches.push(JSON.parse(line));
      } catch {
        // Half a line is what a truncated append leaves behind.
      }
    }
  }

  if (matches.length === 0) {
    console.error(
      `\n  No transcripts yet.\n\n  Nothing in ${LOG_DIR} — play an online match with the server running.\n`
    );
    process.exit(1);
  }

  return matches.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

/**
 * How a match ended, for records written before `decidedBy` existed.
 *
 * An impostor win with no ballot in it is a room that never got to vote, which
 * is a room that emptied. That is the only way to reach the end of a match
 * without one, so the inference is safe — and without it the first matches ever
 * recorded count as wins, which is exactly the number this was meant to fix.
 */
function decidedBy(match) {
  if (match.decidedBy) return match.decidedBy;
  if (!match.outcome) return null;
  if (match.outcome === 'humans') return 'vote';
  return match.ballots.length === 0 ? 'walkout' : 'vote';
}

/** `Mr. Pink `, padded, starred when it is the impostor's seat. */
function seat(line) {
  return `${line.name.padEnd(NAME_WIDTH)}${line.impostor ? '*' : ' '}`;
}

function said(line) {
  if (line.kind === 'departure') {
    const why = line.departedBecause === 'disconnected' ? 'lost their connection' : 'walked out';
    return `── ${line.text || why}`;
  }
  if (line.timedOut) return line.lostConnection ? '(connection went)' : '(ran out of time)';
  return `${line.replyTo ? `@${line.replyTo} ` : ''}${line.text}`;
}

/** The shape line under one of the impostor's messages, when there is one. */
function drawn(model) {
  if (!model) return null;
  const shape = model.shape ?? {};
  const bits = [
    shape.bit ? `BIT=${shape.bit}` : null,
    shape.pushback ? `pushback=${shape.pushback}` : null,
    shape.stance ? `stance=${shape.stance}` : null,
    shape.nameUse ? `names=${shape.nameUse}` : null,
    shape.renamed ? 'ASKED AGAIN' : null,
  ].filter(Boolean);
  const how = model.fellBack ? 'stock line' : `${(model.ms / 1000).toFixed(1)}s`;
  return `${how}${bits.length ? `  ${bits.join(' ')}` : ''}`;
}

function printMatch(match) {
  const when = new Date(match.startedAt).toLocaleString();
  const verdict =
    match.outcome === 'humans'
      ? 'the room won'
      : match.outcome === 'impostor'
        ? decidedBy(match) === 'walkout'
          ? 'the room emptied — not a win it earned'
          : 'the impostor won'
        : 'abandoned';

  console.log(`\n${'─'.repeat(72)}`);
  console.log(`  ${match.matchId.slice(0, 8)}  ${when}  ${match.seats.length} seats  —  ${verdict}`);
  console.log(`  impostor: ${match.impostor ?? '—'}   seats: ${match.seats.map((s) => s.name).join(', ')}`);
  console.log(`${'─'.repeat(72)}`);

  /*
   * A match goes: a round's answers, a ballot, and — only when that tied — a
   * tiebreaker's answers and a second ballot, which carries the same round
   * number as the first. So ballots cannot be looked up by round; they are
   * drained one per stretch of talking, in the order they were cast.
   */
  const ballots = [...match.ballots];
  let segment = null;

  for (const line of match.lines) {
    const key = `${line.round}:${line.tiebreaker}`;
    if (key !== segment) {
      // The vote that closed the stretch just finished, before the next opens.
      if (segment !== null && ballots.length) printBallot(ballots.shift(), match);
      segment = key;
      const prompt = match.prompts.find(
        (p) => p.round === line.round && p.tiebreaker === line.tiebreaker
      );
      console.log(
        `\n  ── ${line.tiebreaker ? 'tiebreaker' : `round ${line.round}`} ─ ${prompt?.prompt ?? ''}\n`
      );
    }

    console.log(`  ${line.round}  ${seat(line)} ${said(line)}`);
    const note = drawn(line.model);
    if (note) console.log(`     ${' '.repeat(NAME_WIDTH)}  ↳ ${note}`);
  }

  while (ballots.length) printBallot(ballots.shift(), match);
  console.log('');
}

function printBallot(ballot, match) {
  const cast = ballot.votes.map((v) => `${v.voter} → ${v.target}`).join('   ') || 'nobody voted';
  const out = ballot.eliminated
    ? `${ballot.eliminated} out${ballot.eliminated === match.impostor ? '  ← the impostor' : ''}`
    : ballot.tied
      ? `tied: ${ballot.tied.join(' / ')}`
      : 'nobody out';
  console.log(`\n  ── vote ─ ${cast}\n  ──        ⇒ ${out}\n`);
}

/** Only the impostor's own lines, across every match — its voice in one place. */
function printImpostorLines(matches) {
  for (const match of matches) {
    const mine = match.lines.filter((l) => l.impostor && l.kind === 'answer');
    if (mine.length === 0) continue;
    const verdict =
      match.outcome === 'humans'
        ? 'caught'
        : decidedBy(match) === 'walkout'
          ? 'room emptied'
          : match.outcome === 'impostor'
            ? 'got away'
            : '—';
    console.log(`\n  ${match.matchId.slice(0, 8)}  as ${match.impostor}  (${verdict})`);
    for (const line of mine) {
      console.log(`    r${line.round}  ${said(line)}`);
      const note = drawn(line.model);
      if (note) console.log(`         ↳ ${note}`);
    }
  }
  console.log('');
}

function printStats(matches) {
  const decided = matches.filter((m) => m.outcome);

  /*
   * A match the room walked out of is not a match it fooled anybody in.
   *
   * The rules score an empty room as an impostor win, correctly — there is
   * nobody left to vote. But counting those as "got away with it" makes the
   * number climb fastest exactly when the impostor is at its worst, which is
   * the opposite of what this is for. They are counted separately and kept out
   * of the rate. Records from before the flag existed are read by inference —
   * see `decidedBy` above.
   */
  const walkouts = decided.filter((m) => decidedBy(m) === 'walkout');
  const played = decided.filter((m) => decidedBy(m) !== 'walkout');
  const gotAway = played.filter((m) => m.outcome === 'impostor').length;

  const lines = matches.flatMap((m) => m.lines).filter((l) => l.kind === 'answer');
  const impostorLines = lines.filter((l) => l.impostor);
  const withModel = impostorLines.filter((l) => l.model);
  const fellBack = withModel.filter((l) => l.model.fellBack).length;
  const timedOut = impostorLines.filter((l) => l.timedOut).length;

  const ms = withModel.map((l) => l.model.ms).sort((a, b) => a - b);
  const median = ms.length ? ms[Math.floor(ms.length / 2)] : 0;
  const slowest = ms.length ? ms[ms.length - 1] : 0;
  const cost = withModel.reduce((sum, l) => sum + (l.model.cost ?? 0), 0);

  const words = (text) => text.trim().split(/\s+/).filter(Boolean).length;
  const avgWords = (rows) =>
    rows.length ? (rows.reduce((s, l) => s + words(l.text), 0) / rows.length).toFixed(1) : '0';

  console.log(`\n  ${matches.length} matches, ${decided.length} decided`);
  console.log(
    `  got away with it   ${gotAway}/${played.length}${
      played.length === 0 ? '  (no match was played to a vote)' : ''
    }`
  );
  if (walkouts.length) {
    console.log(
      `  room walked out    ${walkouts.length}  (scored as wins by the rules, not counted above)`
    );
  }
  console.log(`  its lines          ${impostorLines.length}  (${avgWords(impostorLines)} words avg)`);
  console.log(`  everyone else's    ${lines.length - impostorLines.length}  (${avgWords(lines.filter((l) => !l.impostor))} words avg)`);
  console.log(`  stock fallbacks    ${fellBack}`);
  console.log(`  missed its turn    ${timedOut}`);
  console.log(`  model latency      ${(median / 1000).toFixed(1)}s median, ${(slowest / 1000).toFixed(1)}s worst`);
  console.log(`  spent              $${cost.toFixed(4)}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let matches = read();

  if (args.id) matches = matches.filter((m) => m.matchId.startsWith(args.id));
  if (args.lost) matches = matches.filter((m) => m.outcome === 'humans');
  if (args.won) matches = matches.filter((m) => m.outcome === 'impostor');

  if (matches.length === 0) {
    console.error('\n  Nothing matches those filters.\n');
    process.exit(1);
  }

  // Newest last, so the most recent match is at the bottom of the terminal
  // where you are already looking.
  const shown = args.last === Infinity ? matches : matches.slice(-args.last);

  if (args.stats) return printStats(matches);
  if (args.impostor) return printImpostorLines(shown);
  shown.forEach(printMatch);
}

main();
