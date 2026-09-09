#!/usr/bin/env node

/**
 * What one match of An Impostor costs to run, once the impostor's answers come
 * from a model.
 *
 * Round length is now a financial decision as much as a design one — four
 * turns each costs roughly four times what one does, and a tiebreaker nearly
 * doubles the round it happens in. This exists so that number is in front of
 * you while you tune the game, rather than found out later on a bill.
 *
 * It reads the real settings out of `src/game/types.ts`, so it prices the game
 * as it is currently configured. Everything it cannot read — how long a match
 * runs, how often the room ties, how many tokens a line of chat is — is an
 * assumption, listed in the output and overridable from the command line.
 *
 * The token assumptions are estimates. The moment real calls are being made,
 * replace them with what `response.usage` actually reports: measured numbers
 * beat a model of the numbers, and this file is only useful until then.
 *
 *   node scripts/model-cost.js
 *   node scripts/model-cost.js --turns 4 --model gemma-small
 *   node scripts/model-cost.js --rounds 5 --tiebreakers 0.4 --model-votes
 */

const fs = require('fs');
const path = require('path');

/**
 * Per million tokens, from the OpenRouter pricing table.
 *
 * The game runs on the free copy of Gemma, where every row below is zero and
 * this script has nothing to say. It is kept pointed at the paid copy because
 * the question it answers — what a round of this length costs at scale — is a
 * question about the day the free tier is not enough, and that is the day the
 * numbers here start to matter.
 */
const MODELS = {
  gemma: { id: 'google/gemma-4-31b-it:free', input: 0, output: 0 },
  'gemma-paid': { id: 'google/gemma-4-31b-it', input: 0.09, output: 0.34 },
  'gemma-small': { id: 'google/gemma-4-26b-a4b-it', input: 0.07, output: 0.34 },
  'gemma-batch': { id: 'google/gemma-4-31b-it:batch', input: 0.39, output: 0.97 },
};

/**
 * Cached input is billed at roughly a tenth of the normal input rate — where
 * it is sold at all. It is not sold on Gemma, so the default below is 0 and
 * this multiplier only applies if you point the script at a model that has it.
 */
const CACHE_READ_MULTIPLIER = 0.1;

/**
 * Assumptions the code cannot tell us. Every one of these is a guess until
 * there are real matches to measure.
 */
const ASSUMPTIONS = {
  /** Rounds an average match actually runs, against a `maxRounds` ceiling. */
  rounds: 4,
  /** Share of rounds whose vote ties and goes to a tiebreaker. */
  tiebreakers: 0.3,
  /** Tokens in one line of chat, name and formatting included. */
  tokensPerLine: 25,
  /** The system prompt, rules and persona, sent with every call. */
  systemTokens: 500,
  /** Tokens generated per call — the answer is ~25, the rest is thinking. */
  outputTokens: 150,
  /** Share of input tokens served from cache. 0 means no caching at all. */
  cache: 0,
  /** Whether the impostor's vote costs a model call. It is never observed. */
  modelVotes: false,
  /** Matches per day, for the running-cost table. */
  matches: 1000,
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) continue;
    const name = flag.slice(2);
    if (name === 'model-votes') {
      args.modelVotes = true;
      continue;
    }
    const value = argv[++i];
    args[name] = name === 'model' ? value : Number(value);
  }
  return args;
}

/**
 * The game's own settings, so this prices the game as configured rather than
 * as it was when this script was written.
 */
function readSettings() {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'game', 'types.ts'),
    'utf8'
  );
  const block = source.split('DEFAULT_SETTINGS: MatchSettings = {')[1];
  if (!block) throw new Error('could not find DEFAULT_SETTINGS in src/game/types.ts');

  const read = (key) => {
    const match = block.split('};')[0].match(new RegExp(`${key}:\\s*(\\d+)`));
    if (!match) throw new Error(`could not read ${key} from DEFAULT_SETTINGS`);
    return Number(match[1]);
  };

  return {
    playerCount: read('playerCount'),
    turnsEach: read('turnsEach'),
    maxRounds: read('maxRounds'),
    tiebreakerTurns: read('tiebreakerTurns'),
    tiebreakerTurnsAccused: read('tiebreakerTurnsAccused'),
  };
}

/**
 * Walks a match turn by turn, adding up what the impostor would have to send
 * and generate. Written as a walk rather than a formula because the input cost
 * is dominated by a transcript that grows as the room talks, and a walk is
 * something you can read and argue with.
 */
function priceMatch(settings, a) {
  const { tokensPerLine, systemTokens, outputTokens } = a;
  let inputTokens = 0;
  let calls = 0;

  for (let round = 1; round <= a.rounds; round++) {
    // One player leaves the room each round, roughly.
    const alive = Math.max(2, settings.playerCount - (round - 1));
    // What the impostor has said so far this match, which it is shown so it
    // does not contradict itself between rounds.
    const ownHistory = (round - 1) * settings.turnsEach;

    for (let pass = 1; pass <= settings.turnsEach; pass++) {
      // On average it speaks halfway through each pass round the room.
      const linesThisRound = (pass - 0.5) * alive;
      inputTokens +=
        systemTokens + (linesThisRound + ownHistory + pass - 1) * tokensPerLine;
      calls += 1;
    }

    // A tied round reopens the room. The whole round's answers stay on screen
    // and the tiebreaker talk piles on top, which is why these calls are the
    // expensive ones.
    const roundLines = settings.turnsEach * alive;
    // Two players are put up, so the impostor is the accused this often.
    const accusedShare = Math.min(1, 2 / alive);
    const tieCalls =
      accusedShare * settings.tiebreakerTurnsAccused +
      (1 - accusedShare) * settings.tiebreakerTurns;
    const tieLines = accusedShare * 2 * settings.tiebreakerTurnsAccused +
      (alive - 2) * settings.tiebreakerTurns;

    for (let i = 0; i < tieCalls; i++) {
      const spokenSoFar = (i / Math.max(tieCalls, 1)) * tieLines;
      inputTokens +=
        a.tiebreakers *
        (systemTokens + (roundLines + spokenSoFar + ownHistory) * tokensPerLine);
    }
    calls += a.tiebreakers * tieCalls;

    if (a.modelVotes) {
      // One ballot, plus another on a round that tied.
      const ballots = 1 + a.tiebreakers;
      inputTokens += ballots * (systemTokens + roundLines * tokensPerLine);
      calls += ballots;
    }
  }

  return { calls, inputTokens, outputTokens: calls * outputTokens };
}

function money(value) {
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const settings = readSettings();
  if (cli.turns) settings.turnsEach = cli.turns;

  const a = { ...ASSUMPTIONS, ...cli };
  const modelKey = a.model && MODELS[a.model] ? a.model : 'gemma-paid';
  const model = MODELS[modelKey];

  const { calls, inputTokens, outputTokens } = priceMatch(settings, a);

  const cachedShare = Math.min(1, Math.max(0, a.cache));
  const billedInput =
    inputTokens * (1 - cachedShare) + inputTokens * cachedShare * CACHE_READ_MULTIPLIER;

  const inputCost = (billedInput / 1e6) * model.input;
  const outputCost = (outputTokens / 1e6) * model.output;
  const perMatch = inputCost + outputCost;

  console.log(`\nAn Impostor — what the model costs\n`);
  console.log(`  model            ${model.id}  ($${model.input}/$${model.output} per Mtok)`);
  const turnWord = settings.turnsEach === 1 ? 'turn' : 'turns';
  console.log(`  room             ${settings.playerCount} players, ${settings.turnsEach} ${turnWord} each, max ${settings.maxRounds} rounds`);
  console.log(`  tiebreaker       ${settings.tiebreakerTurnsAccused} turns accused / ${settings.tiebreakerTurns} everyone else`);
  console.log(`\n  assumed          ${a.rounds} rounds a match, ${Math.round(a.tiebreakers * 100)}% of rounds tie`);
  console.log(`                   ${a.tokensPerLine} tokens a line, ${a.systemTokens} token system prompt`);
  console.log(`                   ${a.outputTokens} output tokens a call (answer + thinking)`);
  console.log(`                   ${Math.round(cachedShare * 100)}% of input from cache, votes ${a.modelVotes ? 'cost a call' : 'are free'}`);

  console.log(`\n  per match`);
  console.log(`    calls          ${calls.toFixed(1)}`);
  console.log(`    input          ${Math.round(inputTokens).toLocaleString()} tokens -> ${money(inputCost)}`);
  console.log(`    output         ${Math.round(outputTokens).toLocaleString()} tokens -> ${money(outputCost)}`);
  console.log(`    total          ${money(perMatch)}`);

  console.log(`\n  running cost`);
  for (const perDay of [100, 1000, 10000]) {
    const daily = perMatch * perDay;
    const marker = perDay === a.matches ? ' <-' : '';
    console.log(
      `    ${String(perDay).padStart(6)}/day    ${money(daily).padStart(8)}/day   ${money(daily * 30).padStart(9)}/month${marker}`
    );
  }

  console.log(`\n  every model, at these settings`);
  for (const [key, m] of Object.entries(MODELS)) {
    const cost = (billedInput / 1e6) * m.input + (outputTokens / 1e6) * m.output;
    console.log(
      `    ${key.padEnd(12)} ${money(cost).padStart(8)}/match   ${money(cost * a.matches * 30).padStart(9)}/month at ${a.matches}/day`
    );
  }
  console.log(
    `\n  Token counts are estimates. Replace them with what response.usage\n  reports as soon as real calls exist.\n`
  );
}

main();
