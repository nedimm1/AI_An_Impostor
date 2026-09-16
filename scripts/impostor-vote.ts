/**
 * What the impostor says when the room asks it why it voted the way it did.
 *
 * `impostor-sample.js` cannot answer that. It walks the prompt list with an
 * empty room and no ballot behind it, which is the right shape for reading
 * what the impostor writes cold and the wrong one for this: the question only
 * exists because a vote happened, everybody saw it, and the round it was cast
 * in has scrolled away.
 *
 * So this seats a room and plays one. The room is driven through the real
 * reducer and the payload built by the real `impostorTurn`, so what the model
 * is shown here is what it is shown in a match — only the human lines are
 * written by hand. One turn is bought from the model: the answer.
 *
 *   export OPENROUTER_API_KEY=sk-or-v1-...
 *   npm run impostor:votes
 *   npm run impostor:votes -- --runs 5
 */

import path from 'node:path';

import { roomReducer, type MatchAction } from '../src/game/reducer';
import { impostorTurn } from '../src/game/impostor-payload';
import {
  currentTurnId,
  playerById,
  roundAnswers,
  survivors,
  type Player,
  type Room,
} from '../src/game/types';

// The impostor is CommonJS and stays that way: it runs under plain node on
// the server, with no build step between it and the room.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { writeAnswer } = require('../server/impostor.js');

try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // No .env. The environment is expected to carry the key instead.
}

const YOU = 'you-uuid';

/**
 * Lines for the seats. Written rather than generated because the point is the
 * one answer at the end, and because a vote wants something to hang on: the
 * seat the impostor votes for changes its mind three times, which is a real
 * reason somebody would vote for you and a thing the impostor can only say if
 * the round it voted on is in front of it.
 *
 * `--bland` swaps that for a round where nobody does anything worth voting
 * over, which is the harder half: with nothing to point at, a model will make
 * something up unless it is given somewhere else to go.
 */
const ROUND_ONE = [
  'chicken shop, every time',
  'pizza, boring but true',
  'i had a doner on friday and im still thinking about it',
  'whatever is closest honestly',
  'sushi',
  'actually no, kebab',
  'nandos maybe',
  'thai, the one by the station',
  'anything i dont have to cook',
  'depends how skint i am',
  'wagamamas i guess',
  'fish and chips on a friday',
  'curry',
  'burgers',
  'noodles',
];

const BLAND_ROUND_ONE = [
  // Dealt one per seat in turn order, so every third line is the same person:
  // each of them says the one thing, all three times, and means it.
  'pizza',
  'chinese',
  'indian',
  'pizza',
  'sushi',

  'yeah still pizza',
  'chinese too',
  'indian',
  'pizza yeah',
  'sushi',

  'pizza for me',
  'yeah chinese',
  'indian probably',
  'pizza',
  'sushi i guess',
];

const ROUND_TWO = [
  'coffee, then i can talk',
  'snooze it twice then panic',
  'straight on my phone, bad habit',
  'shower first always',
  'feed the cat before anything',
];

const QUESTION = 'hang on why did you vote for me last round';
/* No "vote" in it, because the second push never has one. */
const PUSH = 'no but why me though';

function strangers(...names: string[]): Player[] {
  return names.map((name) => ({
    id: `p_${name}`,
    name: '',
    tint: '',
    isYou: false,
    connected: true,
    eliminated: false,
  }));
}

/** The seating is random; pinning it makes the first stranger the impostor. */
function pinned<T>(value: number, run: () => T): T {
  const real = Math.random;
  Math.random = () => value;
  try {
    return run();
  } finally {
    Math.random = real;
  }
}

function must(state: Room | null): Room {
  if (!state) throw new Error('no room');
  return state;
}

function play(state: Room | null, ...actions: MatchAction[]): Room {
  return must(actions.reduce(roomReducer, state));
}

function speak(state: Room, text: string, replyToId: string | null = null): Room {
  return play(state, { type: 'answerTurn', text, timedOut: false, replyToId });
}

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    // A flag with nothing after it is a switch, not a value.
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next && !next.startsWith('--') ? argv[++i] : '';
  }
  return args;
}

/** A room played up to the moment the question lands, and the turn that answers it. */
function roomAskedAboutItsVote(roundOne: string[]) {
  let room = play(
    null,
    pinned(0, () => ({
      type: 'startMatch' as const,
      id: 'rm_vote_sample',
      yourId: YOU,
      strangers: strangers('a', 'b', 'c', 'd'),
    }))
  );

  const impostorId = room.impostorId!;
  const nameOf = (id: string) => playerById(room, id)?.name ?? id;

  let said = 0;
  while (room.phase === 'answering') {
    room = speak(room, roundOne[said++ % roundOne.length]);
  }

  /*
   * The room removes one player and the impostor votes somewhere else, so its
   * vote is a lone one — the kind it gets asked about, and the kind it has to
   * account for on its own.
   */
  const alive = survivors(room).map((p) => p.id);
  const others = alive.filter((id) => id !== impostorId);
  const asker = others[0];
  const doomed = others[1];

  room = play(
    room,
    ...alive.map((id) => ({
      type: 'castVote' as const,
      voterId: id,
      targetId: id === impostorId ? asker : doomed,
    }))
  );

  const ballot = room.ballots[room.ballots.length - 1];
  room = play(room, { type: 'nextRound' });

  // Round two, as far as the question. The impostor answers for itself first,
  // because the line the question is pinned to has to be its own.
  let asked: string | null = null;
  let spoke = 0;

  while (room.phase === 'answering' && !asked) {
    const turnOf = currentTurnId(room)!;
    const ownLine = roundAnswers(room).find(
      (a) => a.kind === 'answer' && a.playerId === impostorId
    );

    if (turnOf === asker && ownLine) {
      room = speak(room, QUESTION, ownLine.id);
      asked = roundAnswers(room).at(-1)!.id;
      continue;
    }

    room = speak(room, ROUND_TWO[spoke++ % ROUND_TWO.length]);
  }

  return { room, impostorId, asker, ballot, asked: asked!, nameOf };
}

/** Plays filler turns until it is this seat's go, or the round runs out. */
function advanceTo(room: Room, seatId: string, from: number) {
  let spoke = from;
  while (room.phase === 'answering' && currentTurnId(room) !== seatId) {
    room = speak(room, ROUND_TWO[spoke++ % ROUND_TWO.length]);
  }
  return { room, spoke };
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const runs = Math.max(1, Number(cli.runs ?? 1));

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('\nNo credentials. Set OPENROUTER_API_KEY and run again.\n');
    process.exit(1);
  }

  /*
   * One room for every run. The seats are dealt with `Math.random`, so
   * building a second one would rename everybody halfway down the output; the
   * only thing that should differ between runs is what the model says.
   */
  const bland = 'bland' in cli;
  const { room, impostorId, asker, ballot, asked, nameOf } = roomAskedAboutItsVote(
    bland ? BLAND_ROUND_ONE : ROUND_ONE
  );

  console.log(`\nAn Impostor — being asked about its vote\n`);
  console.log(`  the room       ${room.players.map((p) => nameOf(p.id)).join(', ')}`);
  console.log(`  the impostor   ${nameOf(impostorId)}\n`);

  console.log(
    `  the round it voted on${bland ? '   (nothing in it worth voting over)' : ''}`
  );
  for (const line of room.transcript) {
    if (line.kind === 'answer' && line.round === ballot.round) {
      console.log(`    ${nameOf(line.playerId)}: ${line.text}`);
    }
  }

  console.log(`\n  the vote`);
  for (const [voter, target] of Object.entries(ballot.votes)) {
    const mine = voter === impostorId ? '  <- its own, and the only one' : '';
    console.log(`    ${nameOf(voter)} voted for ${nameOf(target)}${mine}`);
  }
  console.log(
    `    ${ballot.eliminatedId ? `${nameOf(ballot.eliminatedId)} is out` : 'nobody is out'}\n`
  );

  console.log(`  what it answers\n`);

  /*
   * Both beats, because the reason is held back for the second one: asked
   * once it should shrug, and only give the reason up when the room comes
   * back at it. One run is two turns bought from the model.
   */
  let cost = 0;

  for (let i = 0; i < runs; i++) {
    let played = room;

    const shrug = await writeAnswer(impostorTurn(played, asked));
    cost += shrug.usage.cost ?? 0;

    console.log(`    ${nameOf(asker)}: ${QUESTION}`);
    console.log(`    ${nameOf(impostorId)}: ${shrug.text ?? 'EMPTY'}`);

    // Its answer goes back into the room, then they push, then it answers again.
    const afterShrug = advanceTo(played, impostorId, 0);
    played = afterShrug.room;
    if (played.phase !== 'answering') break;

    played = speak(played, shrug.text ?? 'had to be someone', asked);
    const ownLine = roundAnswers(played).at(-1)!.id;

    const afterPush = advanceTo(played, asker, afterShrug.spoke);
    played = afterPush.room;
    if (played.phase !== 'answering') break;

    played = speak(played, PUSH, ownLine);
    const pushed = roundAnswers(played).at(-1)!.id;

    const afterQuestion = advanceTo(played, impostorId, afterPush.spoke);
    played = afterQuestion.room;
    if (played.phase !== 'answering') break;

    const reason = await writeAnswer(impostorTurn(played, pushed));
    cost += reason.usage.cost ?? 0;

    console.log(`    ${nameOf(asker)}: ${PUSH}`);
    console.log(`    ${nameOf(impostorId)}: ${reason.text ?? 'EMPTY'}\n`);
  }

  console.log(`  ${runs} ${runs === 1 ? 'exchange' : 'exchanges'}, ${
    cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`
  }\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
