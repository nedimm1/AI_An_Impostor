#!/usr/bin/env node

/**
 * The impostor, behind a door.
 *
 * This is step 3 of the plan and the smallest thing that can honestly be
 * called a backend: one process, on your machine, holding the API key. The app
 * talks to it over the network and never sees the key, the persona or the
 * prompt — which is the arrangement a real server has, arrived at now so that
 * building the real one later is a deployment rather than a redesign.
 *
 * It is not a product. There is no auth, no rate limiting and no persistence,
 * and it must not be exposed beyond your own network. What it is for is
 * playing the game against a model on a device in your hand, today.
 *
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *   npm run impostor:server
 *
 * It prints the LAN address to put in the app. On a simulator localhost works;
 * on a real phone use the printed address, with the phone on the same wifi.
 */

const http = require('http');
const os = require('os');

const { castVote, writeAnswer } = require('./impostor');

const PORT = Number(process.env.IMPOSTOR_PORT ?? 8787);

/** Running totals, so a session of play reports what it really cost. */
const totals = { calls: 0, votes: 0, failures: 0, empties: 0, input: 0, cached: 0, output: 0 };

function lanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address;
    }
  }
  return 'localhost';
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    // The app is served from a dev origin that is never this one.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // Nothing legitimate is this big; a transcript is kilobytes.
      if (raw.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('body was not json'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  // Something for the app to check before it starts a match, so a room does
  // not discover the server is down on the impostor's first turn.
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { ok: true, ...totals });
  }

  if (req.method !== 'POST' || (req.url !== '/answer' && req.url !== '/vote')) {
    return json(res, 404, { error: 'not found' });
  }
  const voting = req.url === '/vote';

  let turn;
  try {
    turn = await readBody(req);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  if (!voting && (typeof turn.prompt !== 'string' || turn.prompt === '')) {
    return json(res, 400, { error: 'prompt is required' });
  }
  if (voting && !Array.isArray(turn.candidates)) {
    return json(res, 400, { error: 'candidates are required' });
  }

  const started = Date.now();

  if (voting) {
    try {
      const result = await castVote(turn);
      totals.votes += 1;
      totals.output += result.usage.output_tokens ?? 0;
      totals.input += result.usage.input_tokens ?? 0;
      console.log(
        `  ${String(Date.now() - started).padStart(5)}ms  ${result.persona.name.padEnd(6)} votes ${
          result.name ?? '(no valid name)'
        }`
      );
      return json(res, 200, { name: result.name });
    } catch (error) {
      totals.failures += 1;
      console.error(`  vote failed (${error?.status ?? 500}): ${error.message}`);
      // The room falls back to a random vote, exactly like every other seat.
      return json(res, 502, { error: 'upstream' });
    }
  }

  try {
    const result = await writeAnswer(turn);

    totals.calls += 1;
    if (result.text === null) totals.empties += 1;
    totals.input += result.usage.input_tokens ?? 0;
    totals.cached += result.usage.cache_read_input_tokens ?? 0;
    totals.output += result.usage.output_tokens ?? 0;

    const took = Date.now() - started;

    // What it was drawn to do, next to what it wrote. Watching one without
    // the other tells you a line was off but never why.
    const drawn = [
      result.shape?.pushback ? `pushback=${result.shape.pushback}` : null,
      result.shape?.stance ? `stance=${result.shape.stance}` : null,
      result.shape?.nameUse ? `names=${result.shape.nameUse}` : null,
      result.shape?.renamed ? 'ASKED AGAIN' : null,
    ]
      .filter(Boolean)
      .join(' ');

    console.log(
      `  ${String(took).padStart(5)}ms  ${result.persona.name.padEnd(6)} ${
        result.text === null ? '(empty)' : result.text
      }${drawn ? `\n          ${drawn}` : ''}`
    );

    // The shape goes back with the line purely so the app can log it. Nothing
    // on the app side is allowed to depend on it.
    return json(res, 200, { text: result.text, shape: result.shape });
  } catch (error) {
    totals.failures += 1;
    const status = error?.status ?? 500;
    console.error(`  failed (${status}): ${error.message}`);
    // The app falls back to a stock line. It is told nothing about why.
    return json(res, 502, { error: 'upstream' });
  }
});

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error(
    '\nNo credentials. Set ANTHROPIC_API_KEY and run again.\nThe key stays in this process — it is never sent to the app.\n'
  );
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`\nAn Impostor — the impostor is listening\n`);
  console.log(`  simulator        http://localhost:${PORT}`);
  console.log(`  device           http://${lanAddress()}:${PORT}   (same wifi)`);
  console.log(`\n  put that in EXPO_PUBLIC_IMPOSTOR_URL and start the app\n`);
});

/** A session of play is a real cost measurement. Print it on the way out. */
function report() {
  if (totals.calls > 0 || totals.votes > 0) {
    const cost = ((totals.input + totals.cached * 0.1) / 1e6) * 5 + (totals.output / 1e6) * 25;
    console.log(
      `\n  ${totals.calls} turns, ${totals.votes} votes, ${totals.empties} empty, ${totals.failures} failed`
    );
    console.log(`  $${cost.toFixed(4)} of model\n`);
  }
  process.exit(0);
}
process.on('SIGINT', report);
process.on('SIGTERM', report);
