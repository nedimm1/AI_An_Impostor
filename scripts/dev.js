#!/usr/bin/env node

/**
 * Both halves of the game, in the terminal you already have open.
 *
 *   npm run dev
 *   npm run dev -- --android
 *
 * Playing online takes two processes: Metro, serving the app to the phones,
 * and the game server, which is where a match actually runs. They print
 * different halves of the same evening — Metro says which device reloaded, and
 * the server says what the room said to each other — and having them in two
 * terminals means the interesting half is always in the other one.
 *
 * `console.log` cannot close that gap from the app's side, for two reasons and
 * either would be enough. A phone only ever receives its own view of the room,
 * so it does not have the transcript to print; and React Native stopped
 * forwarding logs to the Metro terminal in 0.77, so what it did print would go
 * to React Native DevTools rather than here (see `src/game/round-log.ts`).
 * The room exists in one place, which is the server, so the server's output is
 * brought here instead.
 *
 * METRO KEEPS THE TERMINAL. Its output is inherited rather than piped, so the
 * QR code still draws and `a`, `i` and `r` still do what they do — an
 * interactive process whose stdout is being rewritten is one whose menu stops
 * working. The server is the one being piped in, and its lines are marked so
 * you can tell at a glance which half you are reading.
 */

const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/** Anything after `--` is Metro's, so `npm run dev -- --android` works. */
const EXPO_ARGS = process.argv.slice(2);

/** Off when the output is going to a file, where escape codes are just noise. */
const COLOUR = process.stdout.isTTY;
const dim = (text) => (COLOUR ? `[2m${text}[0m` : text);

let shuttingDown = false;

/*
 * The game server.
 *
 * Piped rather than inherited, which is the whole point of this file: every
 * line it writes is marked and passed on, so the transcript of a match reads
 * as its own thing in among Metro's bundling messages.
 */
const server = spawn('npx', ['tsx', 'server/index.js'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
});

/**
 * Whole lines only. A chunk from a pipe is not a line — it can hold three of
 * them or half of one — and marking chunks puts the mark in the middle of the
 * impostor's sentence.
 */
function marked(stream, write) {
  let held = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = (held + chunk).split('\n');
    // The last piece has no newline yet, so it is the start of the next line.
    held = lines.pop() ?? '';
    for (const line of lines) write(`${dim('game │')} ${line}`);
  });
  stream.on('end', () => {
    if (held) write(`${dim('game │')} ${held}`);
  });
}

marked(server.stdout, (line) => console.log(line));
marked(server.stderr, (line) => console.error(line));

server.on('error', (error) => {
  console.error(`${dim('game │')} could not start: ${error.message}`);
});

server.on('exit', (code) => {
  if (shuttingDown) return;
  // Metro is left running on purpose. The app still loads and still plays on
  // one device; it is online play that has just stopped working, and saying so
  // beats tearing down the thing that was fine.
  console.error(
    `${dim('game │')} the game server stopped (${code}). Metro is still up; online play will not work until it is back.`
  );
});

/*
 * Metro, with the terminal to itself.
 */
const metro = spawn('npx', ['expo', 'start', ...EXPO_ARGS], {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});

metro.on('exit', (code) => {
  // Metro is the one you quit. When it goes, the evening is over.
  shuttingDown = true;
  server.kill('SIGTERM');
  process.exit(code ?? 0);
});

/*
 * Ctrl-C reaches both children on its own, since they share this terminal's
 * process group. What this adds is the wait: the server prints what the
 * session cost on its way out (`report` in `server/index.js`), and a parent
 * that exits immediately takes the terminal back before that lands.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shuttingDown = true;
    server.kill(signal);
    metro.kill(signal);
  });
}
