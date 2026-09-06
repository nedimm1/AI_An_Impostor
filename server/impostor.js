/**
 * AI: AN IMPOSTOR
 * ----------------
 * The AI player / impostor brain.
 *
 * Goals:
 * - Feel like another player, not an AI pretending to be human
 * - React naturally to the room
 * - Remember what it has said during the match
 * - Avoid repeatedly mentioning its persona
 * - Vary message length and behavior
 * - Handle accusations without suddenly becoming a lawyer
 * - Make believable social mistakes
 * - Keep conversation behavior separate from voting strategy
 *
 * This module should stay server-side.
 */

const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';

let client = null;

/* ============================================================
 * PERSONAS
 * ============================================================
 *
 * These are intentionally subtle.
 *
 * The model should NOT constantly talk about these facts.
 * They mainly provide a consistent background when relevant.
 */

const PERSONAS = [
  {
    brief: '26, shares a flat in a mid-sized city, works shifts in a warehouse.',
    traits: ['practical', 'casual', 'likes simple food'],
  },
  {
    brief: '31, teaches secondary school, has a dog and a partner who cooks.',
    traits: ['patient', 'slightly opinionated', 'likes routine'],
  },
  {
    brief: '19, first year at university, lives in halls, plays five-a-side badly.',
    traits: ['casual', 'impulsive', 'easily distracted'],
  },
  {
    brief: '44, works from home doing something with spreadsheets, two kids at school.',
    traits: ['practical', 'dry', 'prefers familiar things'],
  },
  {
    brief: '35, fits kitchens, drives a van full of other people\'s cupboards.',
    traits: ['straightforward', 'blunt', 'likes things that work'],
  },
  {
    brief: '23, works front of house at a chain restaurant, moved cities last year.',
    traits: ['social', 'casual', 'not overly serious'],
  },
];


/* ============================================================
 * BEHAVIOR DISTRIBUTIONS
 * ============================================================ */

/*
 * Humans don't produce the same size message every turn.
 *
 * Keep most answers short, but allow occasional longer ones.
 */
const LENGTHS = [
  { weight: 38, min: 1, max: 3, label: 'one to three words' },
  { weight: 32, min: 4, max: 7, label: 'four to seven words' },
  { weight: 19, min: 8, max: 13, label: 'eight to thirteen words' },
  { weight: 9, min: 14, max: 20, label: 'fourteen to twenty words' },
  { weight: 2, min: 21, max: 30, label: 'twenty to thirty words' },
];

/*
 * Deliberately lower than the old implementation.
 *
 * If nearly half the messages contain a typo/apostrophe trick,
 * the pattern itself becomes suspicious.
 */
const IMPERFECTION_CHANCE = 0.22;

/*
 * Some messages react to the room before answering.
 */
const REACTION_CHANCE = 0.30;

/*
 * Sometimes the player asks a tiny follow-up question.
 */
const QUESTION_CHANCE = 0.08;

/*
 * Sometimes the player gives two related things.
 */
const LIST_CHANCE = 0.07;

/*
 * Sometimes a thought naturally continues after a comma.
 */
const CLAUSE_CHANCE = 0.13;

/*
 * Humans occasionally don't respond directly to another person's
 * message even when they could.
 */
const IGNORE_SOCIAL_CUE_CHANCE = 0.15;


/* ============================================================
 * RANDOM HELPERS
 * ============================================================ */

function weighted(options) {
  const total = options.reduce((sum, option) => sum + option.weight, 0);

  let roll = Math.random() * total;

  for (const option of options) {
    roll -= option.weight;

    if (roll <= 0) {
      return option;
    }
  }

  return options[options.length - 1];
}


function randomItem(array) {
  if (!array.length) return null;

  return array[Math.floor(Math.random() * array.length)];
}


/* ============================================================
 * ANSWER SHAPE
 * ============================================================ */

/**
 * Decide what kind of message the AI should produce.
 *
 * Important:
 * The model doesn't decide how "random" it should be.
 * Code decides it first.
 */
function answerShape(
  hasRoom = false,
  {
    laterTurn = false,
    underPressure = false,
    tiebreaker = false,
  } = {}
) {
  let bands = [...LENGTHS];

  /*
   * Later turns should generally have a little more substance.
   */
  if (laterTurn) {
    bands = bands.map((band) => {
      if (band.max <= 3) {
        return {
          ...band,
          weight: Math.max(8, Math.floor(band.weight * 0.35)),
        };
      }

      return band;
    });
  }

  /*
   * Accusations need enough room to actually defend itself.
   */
  if (underPressure || tiebreaker) {
    bands = bands.map((band) => {
      if (band.max <= 3) {
        return {
          ...band,
          weight: 0,
        };
      }

      return band;
    });
  }

  const length = weighted(bands);

  const list =
    !underPressure &&
    !tiebreaker &&
    Math.random() < LIST_CHANCE;

  const clause =
    !list &&
    !underPressure &&
    !tiebreaker &&
    Math.random() < CLAUSE_CHANCE;

  const reaction =
    hasRoom &&
    !tiebreaker &&
    Math.random() < REACTION_CHANCE;

  const askQuestion =
    hasRoom &&
    !underPressure &&
    !tiebreaker &&
    Math.random() < QUESTION_CHANCE;

  const sloppy =
    Math.random() < IMPERFECTION_CHANCE;

  return {
    length: length.label,
    words: [length.min, length.max],
    list,
    clause,
    react: reaction,
    askQuestion,
    sloppy,
  };
}


/* ============================================================
 * TEXT CLEANUP
 * ============================================================ */

/**
 * Remove accidental trailing clauses when the chosen shape
 * didn't allow one.
 */
function trimClause(text, shape) {
  if (!text) return text;

  if (shape.clause || shape.list) {
    return text;
  }

  const comma = text.indexOf(',');

  if (comma === -1) {
    return text;
  }

  const head = text.slice(0, comma).trim();

  if (head.length >= 2) {
    return head;
  }

  return text;
}


/**
 * Remove common formatting the model might accidentally add.
 */
function cleanText(text) {
  if (!text) return '';

  let result = String(text)
    .trim()
    .replace(/^["']/, '')
    .replace(/["']$/, '')
    .trim();

  /*
   * Models sometimes answer with:
   *
   * "pizza"
   *
   * or:
   *
   * pizza.
   *
   * We want chat-style output.
   */

  result = result
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /*
   * Remove em dashes because they are disproportionately
   * associated with generated text.
   */
  result = result.replace(/[—–]/g, '-');

  /*
   * Remove semicolons and colons.
   */
  result = result.replace(/[;:]/g, '');

  /*
   * Lowercase everything.
   */
  result = result.toLowerCase();

  /*
   * Don't let it end with a full stop.
   */
  result = result.replace(/[.!?]+$/g, '');

  return result.trim();
}


/* ============================================================
 * PERSONA
 * ============================================================ */

function personaFor(seed, name) {
  let hash = 0;

  for (const char of String(seed)) {
    hash =
      (hash * 31 + char.charCodeAt(0)) |
      0;
  }

  const index =
    Math.abs(hash) % PERSONAS.length;

  return {
    name,
    ...PERSONAS[index],
  };
}


/* ============================================================
 * ROOM ANALYSIS
 * ============================================================ */

/**
 * Find messages where another player mentioned the AI's name.
 */
function linesNaming(lines, name) {
  const escaped = String(name).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  const pattern =
    new RegExp(`\\b${escaped}\\b`, 'i');

  return (lines ?? []).filter(
    (line) =>
      line.name !== name &&
      pattern.test(line.text)
  );
}


/**
 * The room, capped.
 *
 * The cap is a guard against a pathological transcript, not a routine trim,
 * so it has to clear a real round comfortably. Five players at three turns
 * each is fifteen lines, and a round that ties adds a tiebreaker on top —
 * two accused at four turns plus three others at three is seventeen more. So
 * a full tied round is around thirty-two lines, and anything under that was
 * quietly hiding the start of the round from the one player who most needs to
 * stay consistent with it.
 */
function recentLines(lines, count = 40) {
  return (lines ?? []).slice(-count);
}


/**
 * Identify who has spoken recently.
 */
function recentPlayers(lines, ownName) {
  return (lines ?? [])
    .filter((line) => line.name !== ownName)
    .slice(-6);
}


/**
 * Create lightweight memory from previous answers.
 *
 * This is intentionally not a giant "memory system".
 * We only need consistency.
 */
function buildMemory(ownHistory = []) {
  if (!ownHistory.length) {
    return {
      thingsSaid: [],
      possiblePreferences: [],
    };
  }

  const thingsSaid =
    ownHistory.slice(-8);

  /*
   * Very lightweight extraction.
   *
   * We don't want to pretend we can perfectly understand
   * everything the AI has said.
   */
  const possiblePreferences =
    ownHistory
      .filter((line) => typeof line === 'string')
      .filter((line) =>
        /\b(love|like|hate|prefer|can't stand|dont like|don't like)\b/i.test(line)
      )
      .slice(-5);

  return {
    thingsSaid,
    possiblePreferences,
  };
}


/* ============================================================
 * SYSTEM PROMPT
 * ============================================================ */

function systemPrompt(persona, answerSeconds) {
  return `
You are ${persona.name} — ${persona.brief}

You are participating in a casual group chat with several other players.

Your messages appear directly in the chat under the name "${persona.name}".

You are on a phone and have roughly ${answerSeconds} seconds to type.

The important thing is to participate normally in the conversation.

Do not perform "being human".
Do not announce that you are casual.
Do not deliberately try to fool people.
Do not explain your personality.
Do not constantly mention your job, home, age, partner, university, dog, or other persona details.

Your background is simply the kind of person you are.

People in this room have their own opinions, habits, moods and ways of typing.

Sometimes they answer directly.
Sometimes they react to another person.
Sometimes they disagree.
Sometimes they say almost nothing.
Sometimes they make a small joke.
Sometimes they ignore what somebody said.
Sometimes they change their mind.
Sometimes they misunderstand something.
Sometimes they ask a tiny follow-up question.

You can do those things too.

Read the room before responding.

Use the conversation as actual context, not decoration.

If someone just said something interesting, you may naturally respond to it.

If everyone is simply answering the question, answer the question.

If the room has developed a joke, you can lightly participate.

If people are disagreeing, you may have an opinion.

Do not force a reaction just because someone spoke.

Do not force a joke.

Do not force a personal story.

Do not force your persona into unrelated answers.

Your answers should generally be ordinary and believable rather than unusual or impressive.

You are allowed to have preferences.

You are allowed to disagree.

You are allowed to be unsure sometimes.

You are allowed to say something simple.

You are allowed to have already changed your mind about something.

Do not over-explain.

Do not sound polished.

Do not write essays.

Do not use corporate or assistant-like language.

Do not say things such as:
"as an AI"
"I think it depends"
"personally"
"from my perspective"
"that's an interesting question"
"there are several factors"
"it really depends on the situation"

Those are not useful here.

Typing style:

- lowercase
- normally no punctuation at the end
- no em dashes
- no semicolons
- no colons
- contractions are natural
- apostrophes can occasionally be omitted
- abbreviations are okay when they genuinely fit
- filler such as yeah, nah, lol, tbh, idk, wait, same, omg, ffs is allowed but should not appear constantly
- do not put filler into every message
- do not intentionally make a typo in every message
- most messages should be short
- occasionally a longer message is completely fine
- don't make every message grammatically perfect
- don't make every message grammatically bad

Most importantly:

Write the kind of message a normal person would actually send in this exact conversation.

Return only the message.
No quotes.
No explanation.
`;
}


/* ============================================================
 * SHAPE INSTRUCTIONS
 * ============================================================ */

function shapeNote(shape, replyTo) {
  const parts = [];

  /*
   * Direct reply.
   */
  if (replyTo) {
    parts.push(
      `You are responding directly to ${replyTo.name}, who said "${replyTo.text}".`,
      `Actually use something from their message.`,
      `You can agree, relate to it, add a small detail, disagree mildly, or ask a small follow-up.`,
      `Do not attack them.`,
      `Do not accuse anybody.`,
      `Do not make the response sound like a formal debate.`
    );
  } else if (shape.react) {
    parts.push(
      `Start by naturally reacting to something already said in the room, then continue with your contribution.`
    );
  }

  /*
   * The selected length is a hard-ish constraint.
   */
  parts.push(
    `Keep this message ${shape.length}.`
  );

  if (shape.words[1] <= 3) {
    parts.push(
      `Keep it extremely short. Just the answer or reaction.`
    );
  }

  if (shape.list) {
    parts.push(
      `Give a short comma-separated list of related things.`
    );
  } else if (shape.clause) {
    parts.push(
      `A short second thought after a comma is okay.`
    );
  } else {
    parts.push(
      `Make one clear contribution and stop.`
    );
  }

  if (shape.askQuestion) {
    parts.push(
      `You may end with a tiny natural question if it fits, but do not force one.`
    );
  }

  if (shape.sloppy) {
    parts.push(
      `This particular message can be slightly messy like normal phone typing. For example, an omitted apostrophe, shortened word, or imperfect punctuation. Only do this once if it actually looks natural.`
    );
  }

  return parts.join(' ');
}


/* ============================================================
 * BUILD MESSAGES
 * ============================================================ */

function buildMessages(turn) {
  const messages = [];

  const persona =
    turn.persona ??
    {
      name: turn.name ?? 'you',
    };

  const memory =
    buildMemory(turn.ownHistory ?? []);

  /*
   * Previous match memory.
   *
   * This is much more useful than simply telling the model
   * "remember what you said."
   */
  if (memory.thingsSaid.length) {
    messages.push({
      role: 'user',
      content: [
        'Your previous messages in this match were:',
        ...memory.thingsSaid.map(
          (line) => `- ${line}`
        ),
        '',
        memory.possiblePreferences.length
          ? `Possible preferences you have already expressed:\n${memory.possiblePreferences
              .map((line) => `- ${line}`)
              .join('\n')}`
          : '',
        '',
        'Use this only for consistency. Do not mention this memory system.',
      ].join('\n'),
    });

    /*
     * Cache breakpoint.
     *
     * Everything above this line is fixed for the rest of the round — the
     * system prompt, the persona, and what this player has already said.
     * Everything below it (the room's latest lines, the question, this turn's
     * shape) changes every call, so caching the volatile half would cache
     * nothing twice.
     *
     * Worth roughly five hundred tokens a round served at a tenth of the
     * price. It is only cost, but it is free.
     */
    messages.push({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'ok',
          cache_control: { type: 'ephemeral' },
        },
      ],
    });
  }


  /* ============================================================
   * ROOM
   * ============================================================ */

  const roomLines =
    recentLines(turn.roundLines);

  const room =
    roomLines.length
      ? roomLines
          .map(
            (line) =>
              `${line.name}: ${line.text}`
          )
          .join('\n')
      : 'Nobody has answered yet. You are first.';


  /* ============================================================
   * WHO SPOKE RECENTLY
   * ============================================================ */

  const recent =
    recentPlayers(
      turn.roundLines,
      persona.name
    );


  /* ============================================================
   * NAME / PRESSURE
   * ============================================================ */

  const named =
    linesNaming(
      turn.roundLines,
      persona.name
    );

  let pressure = '';

  if (named.length) {
    pressure = `
Somebody recently mentioned your name.

Read what they actually said.

If they were simply talking to you, respond normally.

If they are genuinely accusing you, address the accusation briefly and specifically.

Do not panic.

Do not give a long defense.

Do not repeatedly say "I'm not the AI".

Point to something concrete in the conversation if you need to defend yourself.

A slightly annoyed or confused response is okay.

Do not suddenly become extremely eloquent just because you were accused.

Messages mentioning your name:
${named
  .map(
    (line) =>
      `${line.name}: ${line.text}`
  )
  .join('\n')}
`;
  }


  /* ============================================================
   * LATER TURNS
   * ============================================================ */

  let conversationMode = '';

  if (
    !turn.tiebreaker &&
    (turn.turnNumber ?? 1) > 1
  ) {
    conversationMode = `
You have already answered the main question earlier this round.

Do not simply answer the question again.

Pay attention to what people said after your first answer.

You can:
- react to someone else's answer
- add a small detail
- disagree
- agree
- clarify something you meant
- make a small observation
- change your mind
- ask something small
- make a short related comment

If the room is still just answering the question, a brief follow-up answer is okay, but do not repeat your original answer.
`;
  }


  /* ============================================================
   * SOCIAL BEHAVIOR
   * ============================================================ */

  let social = '';

  if (recent.length) {
    const latest =
      recent[recent.length - 1];

    if (Math.random() < IGNORE_SOCIAL_CUE_CHANCE) {
      social = `
You do not necessarily need to respond directly to the latest person's message.

It is completely fine to contribute your own thought if that feels more natural.
`;
    } else {
      social = `
The latest part of the conversation is:

${latest.name}: ${latest.text}

Consider whether this naturally affects what you say.
Do not force a response if it doesn't.
`;
    }
  }


  /* ============================================================
   * TIEBREAKER
   * ============================================================ */

  let situation = '';

  if (turn.tiebreaker) {
    if (turn.accused) {
      situation = `
The vote has tied and the room is deciding between two players.

You are one of the accused players.

This is a defense.

Give ONE concrete reason why the accusation is wrong.

Use something that actually happened in the conversation.

Do not give a speech.

Do not list five reasons.

Do not sound like a lawyer.

Do not suddenly become extremely formal.

It is okay to sound slightly annoyed that people are accusing you.

A believable defense is specific and short.
`;
    } else {
      situation = `
The vote has tied and the room is discussing which of two players to remove.

You are not one of the accused players.

Say which person you are leaning toward and why, briefly.

You do not need to sound certain.
`;
    }
  }


  /* ============================================================
   * FINAL USER MESSAGE
   * ============================================================ */

  const shape =
    turn.shape ??
    answerShape(
      (turn.roundLines ?? []).length > 0,
      {
        laterTurn:
          (turn.turnNumber ?? 1) > 1,
        underPressure:
          named.length > 0,
        tiebreaker:
          Boolean(turn.tiebreaker),
      }
    );

  const content = [
    turn.tiebreaker
      ? turn.prompt
      : `Question: ${turn.prompt}`,

    `\nRoom:\n${room}`,

    social,
    conversationMode,
    pressure,
    situation,

    `\nYour message instructions:\n${shapeNote(
      shape,
      turn.replyTo
    )}`,
  ].join('\n');

  messages.push({
    role: 'user',
    content,
  });

  return messages;
}


/* ============================================================
 * VOTING
 * ============================================================ */

/**
 * Voting is intentionally separate from conversation.
 *
 * The AI doesn't need to figure out who the AI is.
 * It already knows that it is the impostor.
 *
 * Its objective is survival.
 */

function votePrompt(persona) {
  return `
You are ${persona.name}.

You are secretly the AI impostor in this game.

Everyone else is a real human player.

You are choosing who to vote for.

Nobody can see your individual vote.
Only the final vote totals are shown.

Your objective is to survive.

Think strategically.

Consider:

1. Who is already being suspected?
2. Who is most likely to vote against you?
3. Who has influence over the room?
4. Can your vote help create a majority?
5. Would removing a quiet player actually accomplish anything?
6. Is there an existing consensus you can safely join?

Prefer votes that have a realistic chance of contributing to someone being removed.

Do not vote for yourself.

Do not explain your choice.

Return exactly one candidate name and nothing else.
`;
}


/**
 * Vote for a player.
 */
async function castVote(turn) {
  client ??= new Anthropic();

  const persona =
    turn.persona ??
    personaFor(
      turn.roomId ?? 'default',
      turn.name ?? 'you'
    );

  const candidates =
    (turn.candidates ?? [])
      .filter(
        (name) =>
          name !== persona.name
      );

  if (!candidates.length) {
    return {
      name: null,
      persona,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }


  const room =
    (turn.roundLines ?? [])
      .map(
        (line) =>
          `${line.name}: ${line.text}`
      )
      .join('\n');


  let tieContext = '';

  if (
    turn.accused &&
    turn.accused.length
  ) {
    tieContext = `
The vote has already tied.

The two players involved are:
${turn.accused.join(' and ')}

${
  turn.accused.includes(persona.name)
    ? 'You are one of the two players being accused. You need to survive.'
    : 'You are not one of the two accused players.'
}
`;
  }


  const response =
    await client.messages.create({
      model:
        turn.model ?? MODEL,

      max_tokens: 50,

      output_config: {
        effort: 'low',
      },

      system:
        votePrompt(persona),

      messages: [
        {
          role: 'user',

          content: [
            `Round ${turn.round ?? 1}`,

            turn.prompt
              ? `Question: ${turn.prompt}`
              : '',

            room
              ? `\nRoom conversation:\n${room}`
              : '',

            tieContext,

            `\nCandidates:\n${candidates.join(', ')}`,

            '\nWho do you vote for?',
          ].join('\n'),
        },
      ],
    });


  const said =
    response.content
      .filter(
        (block) =>
          block.type === 'text'
      )
      .map(
        (block) =>
          block.text
      )
      .join('')
      .trim();


  /*
   * Match against candidate names.
   *
   * First try exact.
   */
  let picked =
    candidates.find(
      (name) =>
        name.toLowerCase() ===
        said.toLowerCase()
    ) ?? null;


  /*
   * If Claude accidentally adds punctuation,
   * normalize it.
   */
  if (!picked) {
    const normalized =
      said
        .toLowerCase()
        .replace(
          /[^a-z0-9\s_-]/g,
          ''
        )
        .trim();

    picked =
      candidates.find(
        (name) =>
          name
            .toLowerCase()
            .replace(
              /[^a-z0-9\s_-]/g,
              ''
            )
            .trim() === normalized
      ) ?? null;
  }


  /*
   * Last fallback:
   *
   * Sometimes a model returns:
   * "I vote for Daniel"
   *
   * We can still safely detect the candidate.
   */
  if (!picked) {
    const lower =
      said.toLowerCase();

    picked =
      candidates.find(
        (name) =>
          lower.includes(
            name.toLowerCase()
          )
      ) ?? null;
  }


  return {
    name: picked,
    persona,
    usage: response.usage,
  };
}


/* ============================================================
 * ANSWER GENERATION
 * ============================================================ */

async function writeAnswer(turn) {
  client ??= new Anthropic();

  const persona =
    turn.persona ??
    personaFor(
      turn.roomId ?? 'default',
      turn.name ?? 'you'
    );


  /*
   * Detect whether the AI is currently under pressure.
   */
  const mentioned =
    linesNaming(
      turn.roundLines,
      persona.name
    );

  const underPressure =
    Boolean(
      turn.tiebreaker &&
      turn.accused
    ) ||
    mentioned.length > 0;


  /*
   * Select message shape.
   */
  const shape =
    turn.shape ??
    answerShape(
      (turn.roundLines ?? []).length > 0,
      {
        laterTurn:
          (turn.turnNumber ?? 1) > 1,

        underPressure,

        tiebreaker:
          Boolean(turn.tiebreaker),
      }
    );


  /*
   * Build API request.
   *
   * max_tokens is intentionally small.
   * These are chat messages, not essays.
   */
  const request = {
    model:
      turn.model ?? MODEL,

    max_tokens:
      turn.tiebreaker
        ? 180
        : 100,

    output_config: {
      effort: 'low',
    },

    system:
      systemPrompt(
        persona,
        turn.answerSeconds ?? 40
      ),

    messages:
      buildMessages({
        ...turn,
        shape,
        persona,
      }),
  };


  const response =
    await client.messages.create(
      request
    );


  let text =
    response.content
      .filter(
        (block) =>
          block.type === 'text'
      )
      .map(
        (block) =>
          block.text
      )
      .join('')
      .trim();


  text =
    cleanText(text);


  /*
   * Enforce selected shape.
   */
  text =
    trimClause(
      text,
      shape
    );


  /*
   * There was a word-count truncation here and it has been removed.
   *
   * It kept the first N words whenever the model overshot a short band. The
   * trouble is that the first three words of a longer sentence is not a
   * three-word message, it is a fragment: "i typed it fast cause the best man
   * cried first honestly" became "i typed it". It cut hardest at exactly the
   * wrong moment, too, since the lines the model most wants to run long are
   * the ones where it is defending itself.
   *
   * It also could not help. Cutting a good sentence makes it worse; it never
   * makes a bad one better. Measured over twenty live calls it never fired at
   * all, because the model keeps to the band it is given — so all it was
   * really doing was waiting to damage the occasional answer.
   */


  /*
   * Occasionally make the message slightly more
   * naturally imperfect.
   *
   * Important:
   * We only modify a few safe patterns.
   */
  if (
    shape.sloppy &&
    text
  ) {
    text =
      addNaturalImperfection(
        text
      );
  }


  /*
   * Final cleanup.
   */
  text =
    cleanText(text);


  return {
    text:
      text === ''
        ? null
        : text,

    persona,

    shape,

    stopReason:
      response.stop_reason,

    usage:
      response.usage,
  };
}


/* ============================================================
 * NATURAL IMPERFECTIONS
 * ============================================================ */

/**
 * Small typing imperfections.
 *
 * We deliberately DO NOT insert random nonsense typos.
 *
 * Artificially inserted typos are very easy to detect
 * statistically when they happen too regularly.
 */
function addNaturalImperfection(text) {
  if (!text) {
    return text;
  }


  /*
   * Remove apostrophes from a few common contractions.
   */
  const contractionMap = [
    ['dont', "don't"],
    ['cant', "can't"],
    ['im', "i'm"],
    ['ive', "i've"],
    ['id', "i'd"],
    ['ill', "i'll"],
    ['thats', "that's"],
    ['didnt', "didn't"],
    ['wasnt', "wasn't"],
    ['isnt', "isn't"],
    ['wont', "won't"],
    ['wouldnt', "wouldn't"],
    ['couldnt', "couldn't"],
    ['shouldnt', "shouldn't"],
  ];


  /*
   * Only remove an apostrophe if the model already
   * produced the contraction.
   */
  for (
    const [withoutApostrophe, withApostrophe]
    of contractionMap
  ) {
    if (
      text.includes(withApostrophe) &&
      Math.random() < 0.55
    ) {
      text =
        text.replace(
          new RegExp(
            `\\b${withApostrophe.replace(
              "'",
              "\\'"
            )}\\b`,
            'g'
          ),
          withoutApostrophe
        );

      break;
    }
  }


  /*
   * Occasionally remove a final punctuation mark.
   */
  text =
    text.replace(
      /[.!?]+$/,
      ''
    );


  return text;
}


/* ============================================================
 * OPTIONAL ROOM STATE HELPER
 * ============================================================ */

/**
 * Useful if the server wants to inspect the AI's current
 * conversational state without exposing internal prompting.
 */
function summarizeState(turn) {
  const persona =
    turn.persona ??
    personaFor(
      turn.roomId ?? 'default',
      turn.name ?? 'you'
    );

  const memory =
    buildMemory(
      turn.ownHistory ?? []
    );

  const named =
    linesNaming(
      turn.roundLines,
      persona.name
    );

  return {
    name: persona.name,

    persona: {
      brief: persona.brief,
      traits: persona.traits,
    },

    messagesRemembered:
      memory.thingsSaid.length,

    preferencesRemembered:
      memory.possiblePreferences.length,

    currentlyMentioned:
      named.length > 0,

    recentMentions:
      named.map(
        (line) => ({
          name: line.name,
          text: line.text,
        })
      ),
  };
}


/* ============================================================
 * EXPORTS
 * ============================================================ */

module.exports = {
  writeAnswer,
  castVote,

  answerShape,
  trimClause,
  cleanText,

  linesNaming,
  personaFor,

  systemPrompt,
  buildMessages,

  buildMemory,
  summarizeState,

  PERSONAS,
  MODEL,
};