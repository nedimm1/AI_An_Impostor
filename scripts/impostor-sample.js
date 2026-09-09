#!/usr/bin/env node

/**
 * Reads out what the impostor actually writes, without playing a match.
 *
 * This calls `server/impostor.js` directly — the same module the game calls
 * through the proxy — so what it prints is evidence about the thing that
 * ships rather than about a script. If the prompt in there changes, this
 * changes with it, and there is no second copy to drift.
 *
 * It walks the 43 prompts as one seated player, with the answers accumulating
 * as its own history, and prints each line beside a human-written stock line.
 * The turns are sequential and the impostor is shown what it already said for
 * a reason: 43 independent calls produce 43 lines of the same shape, and one
 * persona repeating its own sentence structure is the tell this exists to
 * find.
 *
 *   export OPENROUTER_API_KEY=sk-or-v1-...
 *   npm run impostor:sample
 *   npm run impostor:sample -- --limit 8 --persona 2
 */

const fs = require('fs');
const path = require('path');

/*
 * `.env`, if there is one.
 *
 * Node reads it natively now, and this is the only place the key is allowed
 * to come from besides the environment. Wrapped because a missing `.env` is
 * the normal case for anyone exporting the variable by hand.
 */
try {
  process.loadEnvFile(path.join(__dirname, '..', '.env'));
} catch {
  // No .env. The environment is expected to carry the key instead.
}

const { writeAnswer, PERSONAS, MODEL } = require('../server/impostor');

const ROOT = path.join(__dirname, '..');

/**
 * Short names for the command line, so `--model gemma` works.
 *
 * The cost is no longer estimated from a table here: OpenRouter reports what
 * each call actually cost in `usage.cost`, and a measured number beats a
 * model of one. On a `:free` model it is zero.
 */
const ALIASES = {
  gemma: 'google/gemma-4-31b-it:free',
  'gemma-paid': 'google/gemma-4-31b-it',
  'gemma-small': 'google/gemma-4-26b-a4b-it:free',
};

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[++i];
  }
  return args;
}

function readPrompts() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'game', 'prompts.json'), 'utf8'));
}

/**
 * The human-written filler the impostor has to sit next to, read out of
 * `mock.ts` rather than copied so this cannot drift from what the room says.
 */
function readStockAnswers() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'game', 'mock.ts'), 'utf8');
  const block = source.split('const STOCK_ANSWERS = [')[1];
  if (!block) throw new Error('could not find STOCK_ANSWERS in src/game/mock.ts');
  return [...block.split('];')[0].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

function readAnswerSeconds() {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'game', 'types.ts'), 'utf8');
  const match = source
    .split('DEFAULT_SETTINGS: MatchSettings = {')[1]
    ?.split('};')[0]
    .match(/answerSeconds:\s*(\d+)/);
  return match ? Number(match[1]) : 40;
}

function money(value) {
  return value >= 1 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

/** Population standard deviation. The number this whole exercise turns on. */
function spread(values) {
  const mean = values.reduce((sum, n) => sum + n, 0) / values.length;
  return Math.sqrt(values.reduce((sum, n) => sum + (n - mean) ** 2, 0) / values.length);
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const model = ALIASES[cli.model] ?? cli.model ?? MODEL;

  const prompts = readPrompts();
  const stock = readStockAnswers();
  const answerSeconds = readAnswerSeconds();
  const limit = Math.min(cli.limit ? Number(cli.limit) : prompts.length, prompts.length);
  // The game gets the name off the seat the matchmaker gave it; a sample has
  // no seat, so one is picked here purely so the output has somebody in it.
  const NAMES = ['Deniz', 'Mara', 'Kofi', 'Ines', 'Rune', 'Priya'];
  const index =
    cli.persona !== undefined
      ? Number(cli.persona) % PERSONAS.length
      : Math.floor(Math.random() * PERSONAS.length);
  const persona = { name: NAMES[index], ...PERSONAS[index] };

  if (!process.env.OPENROUTER_API_KEY) {
    console.error('\nNo credentials. Set OPENROUTER_API_KEY and run again.\n');
    process.exit(1);
  }

  console.log(`\nAn Impostor — what the impostor writes\n`);
  console.log(`  model            ${model}`);
  console.log(`  playing          ${persona.name}, ${persona.brief}`);
  console.log(`  clock            ${answerSeconds}s a turn`);
  console.log(`  prompts          ${limit} of ${prompts.length}\n`);

  const ownHistory = [];
  const rows = [];
  const usage = { calls: 0, empties: 0, input: 0, cacheWrite: 0, cacheRead: 0, output: 0, cost: 0 };
  const started = Date.now();

  for (let i = 0; i < limit; i++) {
    const prompt = prompts[i];
    let result;
    try {
      result = await writeAnswer({
        roomId: `sample_${persona.name}`,
        persona,
        model,
        prompt,
        answerSeconds,
        // No room: this is one voice answering in isolation, which is the
        // harder test. In a match it also has everyone else's lines to work
        // against, which makes blending in easier, not harder.
        roundLines: [],
        ownHistory: [...ownHistory],
      });
    } catch (error) {
      console.error(`\n  ${error.status ? `api error ${error.status}` : ''} ${error.message}\n`);
      break;
    }

    usage.calls += 1;
    usage.input += result.usage.input_tokens ?? 0;
    usage.cacheWrite += result.usage.cache_creation_input_tokens ?? 0;
    usage.cacheRead += result.usage.cache_read_input_tokens ?? 0;
    usage.output += result.usage.output_tokens ?? 0;
    usage.cost += result.usage.cost ?? 0;

    if (result.text === null) {
      usage.empties += 1;
      console.log(`  ${prompt}`);
      console.log(`    EMPTY   stop_reason=${result.stopReason}\n`);
      continue;
    }

    ownHistory.push(result.text);
    rows.push({ prompt, answer: result.text, stock: stock[i % stock.length], shape: result.shape });

    console.log(`  ${prompt}`);
    console.log(`    model   ${result.text}`);
    console.log(`    stock   ${stock[i % stock.length]}`);
    console.log(`    asked   ${result.shape.length}${result.shape.clause ? ', with a clause' : ''}\n`);
  }

  if (usage.calls === 0) process.exit(1);

  const cost = usage.cost;
  const totalInput = usage.input;
  const cachedShare = totalInput > 0 ? usage.cacheRead / totalInput : 0;

  console.log(`  what it cost`);
  console.log(`    calls          ${usage.calls}${usage.empties ? ` (${usage.empties} empty)` : ''}`);
  console.log(`    input          ${totalInput.toLocaleString()} tokens (${Math.round(cachedShare * 100)}% cached)`);
  console.log(`    output         ${usage.output.toLocaleString()} tokens`);
  console.log(`    total          ${money(cost)}   (${money(cost / usage.calls)} a turn)`);
  console.log(`    took           ${Math.round((Date.now() - started) / 1000)}s\n`);

  console.log(`  measured, for scripts/model-cost.js`);
  console.log(`    outputTokens   ${Math.round(usage.output / usage.calls)} a call`);
  console.log(`    cache          ${cachedShare.toFixed(2)}\n`);

  // The read is the point, but the spread is the thing that got measured
  // wrong the first time and is the reason the shape is drawn in code now.
  const words = rows.map((r) => r.answer.split(/\s+/).length);
  const stockWords = [...new Set(rows.map((r) => r.stock))].map((s) => s.split(/\s+/).length);
  const clauses = rows.filter((r) => r.answer.includes(',')).length;

  console.log(`  how the answers read`);
  console.log(`    words          ${Math.min(...words)}-${Math.max(...words)}, spread ${spread(words).toFixed(1)}`);
  console.log(`    stock          ${Math.min(...stockWords)}-${Math.max(...stockWords)}, spread ${spread(stockWords).toFixed(1)}`);
  console.log(`    comma clause   ${clauses}/${rows.length} = ${Math.round((100 * clauses) / rows.length)}%   (stock ${Math.round((100 * [...new Set(rows.map((r) => r.stock))].filter((s) => s.includes(',')).length) / stockWords.length)}%)\n`);

  if (cli.out) {
    fs.writeFileSync(cli.out, JSON.stringify({ model, persona, usage, cost, rows }, null, 2));
    console.log(`  written to ${cli.out}\n`);
  }
}

main();
