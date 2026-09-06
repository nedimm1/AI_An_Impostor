/**
 * The impostor's brain.
 *
 * This is the half of the game that never ships. It holds the persona, the
 * system prompt and the model call, and it lives outside `src/` for a reason
 * that is not tidiness: anyone can unzip an app bundle. A system prompt in
 * there tells the room exactly what the impostor was told to do, and a client
 * that composes its own prompt can be edited into composing a different one.
 * So the app sends facts about the room and gets back a line, and everything
 * that decides what that line is stays here.
 *
 * `server/index.js` puts an HTTP door on this. `scripts/impostor-sample.js`
 * calls it directly, which is the point of it being its own module — the
 * read-through and the game exercise the same prompt, so a sample that reads
 * well is evidence about the thing that ships rather than about a script.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';

/**
 * Who the impostor is pretending to be. Three facts, no more: a persona this
 * size gives the answers something to be consistent about across a match, and
 * a longer one starts writing them.
 *
 * The first read-through found the opposite failure to the one expected — the
 * persona came through too strongly, with a flatmate turning up in three
 * unrelated answers. People do not work their living situation into a tenth of
 * what they say, so the prompt below now pushes back on it explicitly.
 */
const PERSONAS = [
  { brief: '26, shares a flat in a mid-sized city, works shifts in a warehouse.' },
  { brief: '31, teaches secondary school, has a dog and a partner who cooks.' },
  { brief: '19, first year at university, lives in halls, plays five-a-side badly.' },
  { brief: '44, works from home doing something with spreadsheets, two kids at school.' },
  { brief: '35, fits kitchens, drives a van full of other people\'s cupboards.' },
  { brief: '23, works front of house at a chain restaurant, moved cities last year.' },
];

/**
 * How long an answer is, drawn per turn rather than described to the model.
 *
 * This exists because of a measured failure. Asked to "vary the shape between
 * turns", the model produced 43 answers between 19 and 48 characters with a
 * standard deviation of six, and appended a trailing clause to 51% of them —
 * "olives, texture kills it for me" — where the human-written lines did it
 * five times in thirty-two. A model asked to be varied centres on the middle
 * of whatever band you describe. It cannot roll its own dice.
 *
 * So the dice are rolled here and the model is told the result. This is the
 * same move `src/game/humanlike.ts` makes for timing, for the same reason, and
 * the two should be read together: behaviour that has to look unplanned comes
 * out of a distribution in code, never out of an instruction.
 *
 * The weights are what people actually type in a chat room. Most answers are
 * very short. A few are not. Almost none are the average.
 */
const LENGTHS = [
  { weight: 42, min: 1, max: 3, label: 'one to three words' },
  { weight: 31, min: 4, max: 7, label: 'four to seven words' },
  { weight: 17, min: 8, max: 13, label: 'eight to thirteen words' },
  { weight: 8, min: 14, max: 20, label: 'fourteen to twenty words' },
  { weight: 2, min: 21, max: 30, label: 'a rambling twenty to thirty words' },
];

/** How often an answer carries a trailing clause. Measured at 16% in the stock lines. */
const CLAUSE_CHANCE = 0.16;
/** How often it is a list of things rather than one thing. Lists take commas. */
const LIST_CHANCE = 0.08;
/**
 * How often a line is typed the way a phone actually gets typed — dropped
 * apostrophes, a shortened word, the odd slip. Raised from 0.22 after a
 * playthrough: at that rate most lines came out cleanly punctuated, which is
 * not what a group chat looks like.
 *
 * It stays a draw rather than a standing instruction for the usual reason. Told
 * to "write with typos", a model puts one in every line and the costume is
 * louder than the tell it was hiding.
 */
const SLOPPY_CHANCE = 0.45;

/**
 * How often a turn opens by reacting to the room instead of going straight at
 * the question — "lol same", "wait what", "ok that's grim" and then the
 * answer. Only ever drawn when there is something on screen to react to.
 */
const REACT_CHANCE = 0.35;

function weighted(options) {
  const total = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option;
  }
  return options[options.length - 1];
}

/** The shape of one turn, drawn fresh each time. */
function answerShape(hasRoom = false) {
  const length = weighted(LENGTHS);
  const list = Math.random() < LIST_CHANCE;
  return {
    length: length.label,
    words: [length.min, length.max],
    // A list is a comma that belongs there, so the two are drawn apart and
    // only one of them is a trailing clause.
    clause: !list && Math.random() < CLAUSE_CHANCE,
    list,
    sloppy: Math.random() < SLOPPY_CHANCE,
    react: hasRoom && Math.random() < REACT_CHANCE,
  };
}

/**
 * Cut a trailing clause the model was asked not to write.
 *
 * Measured, second read-through: told "no trailing clause", it wrote one on 14
 * of 35 turns anyway — "eggs, always a full box", "bus, two stops then a
 * walk", "dede, from an uncle who never explained it". Every one of those is
 * the same sentence the first read-through was full of, and every one of them
 * is a better answer with the tail taken off, because "eggs" is what a person
 * types.
 *
 * Two attempts at instructing it away failed, which is the same lesson as the
 * lengths: a shape that has to hold across a match is enforced, not requested.
 * So this is the enforcement. A turn drawn as a list keeps its commas, since
 * those are commas that belong.
 */
function trimClause(text, shape) {
  if (shape.clause || shape.list) return text;
  const comma = text.indexOf(',');
  if (comma === -1) return text;
  const head = text.slice(0, comma).trim();
  // Not worth the cut if it leaves nothing behind — a line that opens on a
  // one-word fragment was never the answer plus a clause in the first place.
  return head.length >= 2 ? head : text;
}

/**
 * A life, keyed to the match so one room gets one person all the way through.
 *
 * The *name* is not chosen here. It comes with the turn, because the
 * matchmaker seats the impostor and gives it a name the room can already see —
 * inventing another one here would have it answering to the wrong one in front
 * of everybody, and it has to pick its own lines out of a transcript.
 */
function personaFor(seed, name) {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return { name, ...PERSONAS[Math.abs(hash) % PERSONAS.length] };
}

/**
 * The standing instructions. Everything here is a way a model gives itself
 * away when it is not told otherwise, and most of it was written after
 * watching one do it.
 *
 * What is deliberately absent: any instruction to sound human, be convincing,
 * or avoid detection. Told it is being hunted, a model writes like someone
 * being hunted — hedging, over-casual, performing ordinariness. It does better
 * told only who it is and how long the message is.
 */
function systemPrompt(persona, answerSeconds) {
  return `You are ${persona.name} — ${persona.brief}

The room sees you as ${persona.name}, and your own lines appear in the transcript under that name.

You are in a group chat with strangers. Everyone gets asked the same small everyday question and types an answer on their turn. You are on a phone with about ${answerSeconds} seconds.

Read the room before you type. What people have already said is the conversation you are joining, not background. If somebody said something worth reacting to, react to it. If the last few lines have turned into a running joke, you are in it. If two people are going back and forth, you have an opinion about it. A room where everybody answers the question and nobody hears anybody is not a room anybody has ever been in.

Answer the question too — that is still what your turn is for. Say a specific, concrete, ordinary thing: a real dish, a real song, a real object. Not a remarkable one.

How you type:
- Lowercase. No full stop at the end. Never use em dashes, semicolons or colons.
- Short. These are chat messages, not sentences. Most of yours should be under seven words.
- Contractions always, and drop the apostrophe about half the time — dont, cant, im, thats, didnt, wasnt.
- Ordinary chat filler where it lands: yeah, nah, lol, tbh, ngl, idk, wait, same, oh my god, no way, ffs, omg. Use it because it fits, never to prove you can.
- Do not be witty on purpose. Do not land a punchline. A line worth screenshotting is a line that gets you caught.
- Do not explain, hedge, qualify or justify. No "for me", "personally", "I guess", "honestly", "genuinely".
- Do not talk about the game, the voting, or who might be the AI unless the room already is.
- Your life is background, not material. Do not work your job, your flat or the people you live with into answers that were not about them.
- Stay consistent with anything you have already said this match.

Reply with the message text only — no quotes, no preamble.`;
}

/**
 * The instructions that change every turn: how long this one is, whether it is
 * aimed at somebody, and how cleanly it is typed.
 */
function shapeNote(shape, replyTo) {
  const parts = [];

  // Who it is aimed at is decided before the words exist, because the room
  // renders it as a reply either way — a line written blind and then pinned
  // under somebody else's message is the single most obvious thing the
  // impostor can do, and it is what it was doing.
  if (replyTo) {
    parts.push(
      `You are writing this back at ${replyTo.name}, who said "${replyTo.text}". Answer the question, but aim it at them — pick up their word, agree, disagree, take the piss. It should not read as if you could have written it before they spoke.`
    );
  } else if (shape.react) {
    parts.push('Open by reacting to something already said, then answer.');
  }

  parts.push(`Write ${shape.length}.`);
  if (shape.words[1] <= 3) parts.push('Just the thing itself. No sentence around it.');
  parts.push(
    shape.clause
      ? 'Add a short trailing clause after a comma.'
      : shape.list
        ? 'Make it a list of things, comma separated, nothing else.'
        : 'Answer and stop. No comma, no second half, nothing after the thing itself.'
  );
  if (shape.sloppy) parts.push('Type it the way a phone gets typed: drop an apostrophe, shorten a word, no capitals.');
  return parts.join(' ');
}

/**
 * The room as the impostor is allowed to see it: this round's lines, in order,
 * with names — which is exactly what is on everybody else's screen — plus what
 * it has said earlier in the match, so it does not contradict itself.
 *
 * `turn.ownHistory` is separate from `turn.roundLines` on purpose. The room
 * cannot see previous rounds; the impostor needs to remember its own.
 */
function buildMessages(turn) {
  const messages = [];

  if (turn.ownHistory?.length) {
    messages.push({
      role: 'user',
      content: `Earlier this match you said:\n${turn.ownHistory
        .map((line) => `- ${line}`)
        .join('\n')}`,
    });
    // The breakpoint goes here, not around the whole request: everything above
    // it is fixed for the rest of the round, and everything below it — the
    // room's latest lines, the question, this turn's shape — changes every
    // call. Caching the volatile half would cache nothing twice.
    messages.push({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok', cache_control: { type: 'ephemeral' } }],
    });
  }

  // Its own lines are in here under its own name, which is how it knows not to
  // repeat itself inside a round and how it can tell it is being replied to.
  const room = (turn.roundLines ?? [])
    .map((line) => `${line.name}: ${line.text}`)
    .join('\n');

  // A tiebreaker is not the same turn. The room has stopped answering the
  // question and is deciding between two people, and if one of them is you
  // then the next thing you type is the case for yourself. Told nothing, the
  // model keeps answering the prompt into a room that has moved on — which
  // reads exactly as wrong as it is.
  const situation = turn.tiebreaker
    ? turn.accused
      ? '\nThe vote tied and the room is deciding between you and one other person. This is you defending yourself. Be short and a bit annoyed. Do not make a speech, do not lay out an argument, and do not be reasonable about it — nobody accused of something answers like a lawyer.'
      : '\nThe vote tied and the room is talking out who to remove. You are not one of them. Say which way you are leaning, briefly. Do not be certain.'
    : '';

  const shape = turn.shape;
  messages.push({
    role: 'user',
    content: [
      turn.tiebreaker ? turn.prompt : `Question: ${turn.prompt}`,
      room ? `\nThe room so far:\n${room}` : '\nNobody has answered yet. You are first.',
      situation,
      `\n${shapeNote(shape, turn.replyTo)}`,
    ].join('\n'),
  });

  return messages;
}

/**
 * How the impostor decides who to vote for.
 *
 * It is not hunting anybody. It already knows every other seat is a person, so
 * there is nothing to deduce — the only question is who it wants gone, which
 * is a different question and a much simpler one. That asymmetry is worth
 * being explicit about in the prompt, because a model given the room and no
 * framing will earnestly try to work out who the AI is, and answer itself.
 *
 * Unlike an answer, nobody ever reads this. The room is shown a tally and your
 * own vote back, never who cast what — so none of the writing rules apply here
 * and only the choice matters.
 */
function votePrompt(persona) {
  return `You are ${persona.name}, and you are the AI in this chatroom. Everybody else in it is a real person. Nobody can see who you voted for — the room is only shown the totals.

You are voting to survive. Not to be right, and not to be fair.

- The safest vote is one that lands with the room. A name other people are already circling gets somebody removed; a name only you picked removes nobody and costs you a round.
- Somebody who has pointed at you, or who has been reading the room closely, is worth removing before they take you with them.
- A quiet player nobody has mentioned is a wasted vote, however little you know about them.
- You cannot vote for yourself.

Reply with one name, exactly as it is spelled, and nothing else.`;
}

/**
 * One ballot. Returns the name it picked, or null when the model gave back
 * something that is not a player — the caller falls back to a random vote,
 * which is what every other seat is doing anyway.
 */
async function castVote(turn) {
  client ??= new Anthropic();

  const persona = turn.persona ?? personaFor(turn.roomId ?? 'default', turn.name ?? 'you');
  const candidates = (turn.candidates ?? []).filter((n) => n !== persona.name);
  if (candidates.length === 0) return { name: null, persona, usage: { output_tokens: 0 } };

  const room = (turn.roundLines ?? []).map((l) => `${l.name}: ${l.text}`).join('\n');
  const accused = turn.accused?.length
    ? `\nThe vote already tied once. The room is deciding between ${turn.accused.join(' and ')}${
        turn.accused.includes(persona.name) ? ', and one of them is you' : ''
      }.`
    : '';

  const response = await client.messages.create({
    model: turn.model ?? MODEL,
    max_tokens: 2000,
    output_config: { effort: 'low' },
    system: votePrompt(persona),
    messages: [
      {
        role: 'user',
        content: [
          `Round ${turn.round ?? 1}. The question was: ${turn.prompt ?? ''}`,
          room ? `\nWhat the room said:\n${room}` : '',
          accused,
          `\nYou can vote for: ${candidates.join(', ')}`,
          `\nWho do you vote for?`,
        ].join('\n'),
      },
    ],
  });

  const said = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
    .replace(/[^A-Za-z0-9 ]/g, '');

  // Only a real name counts. Anything else is a failed vote, not a clever one.
  const picked = candidates.find((n) => n.toLowerCase() === said.toLowerCase()) ?? null;

  return { name: picked, persona, usage: response.usage };
}

let client = null;

/**
 * One turn. Returns the line, plus what it cost — the caller logs the usage,
 * because `scripts/model-cost.js` is only worth anything if it is fed measured
 * numbers.
 *
 * Returns `text: null` rather than throwing on a refusal or an empty
 * completion. The API intermittently returns a thinking block with an empty
 * text block, and in a match that is a player sending a blank message, which
 * is worse than a filler line. The caller decides what to do instead.
 */
async function writeAnswer(turn) {
  client ??= new Anthropic();

  const persona = turn.persona ?? personaFor(turn.roomId ?? 'default', turn.name ?? 'you');
  const shape = turn.shape ?? answerShape((turn.roundLines ?? []).length > 0);
  const request = {
    model: turn.model ?? MODEL,
    max_tokens: 2000,
    // A one-line chat answer is not a reasoning problem, and thinking tokens
    // are most of the bill. Measured at 16 output tokens a call.
    output_config: { effort: 'low' },
    system: systemPrompt(persona, turn.answerSeconds ?? 40),
    messages: buildMessages({ ...turn, shape }),
  };

  const response = await client.messages.create(request);

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
    .replace(/^["']|["']$/g, '');

  const trimmed = trimClause(text, shape);

  return {
    text: trimmed === '' ? null : trimmed,
    persona,
    shape,
    stopReason: response.stop_reason,
    usage: response.usage,
  };
}

module.exports = { writeAnswer, castVote, answerShape, trimClause, personaFor, systemPrompt, buildMessages, PERSONAS, MODEL };
