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


/*
 * What a message is FOR, decided before it is written.
 *
 * The shape used to control how long a message was and how messy, but never
 * what it did, and a model handed a transcript with no brief does the one
 * move that is always available: it rates the last thing it read. Rounds came
 * out as a column of "yeah same" and "nah not for me" without a single line
 * in them that would still have existed if nobody else had spoken. That is
 * not a person in a chat, it is a comment section.
 *
 * So the stance is drawn first, and agreeing and disagreeing are two entries
 * on the list rather than the whole list. Together they are under a third of
 * turns; the rest of the time it has to bring something of its own, which is
 * what everybody else in the room is doing.
 */
/*
 * Answering the question is not a stance, it is the turn.
 *
 * On the first time round, the question is on the screen and unanswered and
 * everybody is putting up what they think. A player who spends that turn
 * having a view about somebody else's answer never actually answers - asked
 * for a pizza topping, with one person already saying pineapple, it was
 * replying "thats not a topping" instead of saying pepperoni. Which is a
 * thing people do, occasionally, and it was doing it constantly.
 *
 * So while its own answer is still outstanding there is essentially one
 * stance, and the small remainder is the person who answers sideways.
 */
const STANCES_ANSWERING = [
  {
    weight: 88,
    key: 'own',
    note: 'Answer the question. Your own answer, plainly - not a view on somebody else\'s, not a comment on the room. What you would actually say if you were asked this.',
  },
  {
    weight: 12,
    key: 'tangent',
    note: 'Answer, but sideways - the thing the question reminded you of, or the answer nobody is expecting. Still an answer.',
  },
];

/*
 * Once it has answered, the round stops being a queue and becomes a
 * conversation, and having a view is the whole of it.
 *
 * Agreeing and disagreeing are first-class here rather than hedged. They were
 * written to be talked out of - "the agreement is the smaller half of the
 * message", "lead with what you think rather than with the objection" - which
 * produced a player who never quite committed to anything, and a room full of
 * people who never commit is not a room, it is a survey.
 */
/*
 * The two stances that only exist when the room has put them on the table.
 *
 * Standing by what you said is not the same move as disagreeing. Disagreeing
 * is having a view about somebody else's answer; this is somebody having a
 * view about yours, which is the one thing in a chat that genuinely demands a
 * reply. Left out, the impostor said pepperoni, got told pepperoni is the
 * boring answer, and moved on to something else entirely — which reads as a
 * player who does not care what they said an hour ago, and nobody argues
 * about pizza and then does that.
 *
 * Backing somebody else is the same instinct pointed outwards, and it is the
 * most socially readable thing anybody does in a group chat: two people go at
 * one, and a third takes a side. It also happens to be very good cover, which
 * is not the reason it is here, but it is true.
 */
const STANCE_DEFEND = {
  weight: 90,
  key: 'defend',
  note: 'Somebody has come back at what you said. Stand by it. Say why you think what you think - a reason, an example, the thing that makes it obvious to you. Do not fold and do not go quiet on it just because somebody pushed, and do not turn it into a row either. You are allowed to concede a small part of it if you actually would.',
};

const STANCE_BACK = {
  weight: 22,
  key: 'back',
  note: 'Somebody in this room is getting it from more than one side and you think they are basically right. Take their side. Say what is right about what they said, or what is wrong with the pile-on. Back the opinion, not the person - you are agreeing with a take, not defending a friend.',
};

const STANCES_TALKING = [
  {
    weight: 24,
    key: 'own',
    note: 'Say your own thing. Not a verdict on somebody else - something that would still have existed if nobody had spoken.',
  },
  {
    weight: 21,
    key: 'build',
    note: 'Take what the room is on somewhere slightly new. A detail, a consequence, a case it reminds you of. An addition, not a verdict on somebody.',
  },
  {
    weight: 12,
    key: 'tangent',
    note: 'Say the small thing the conversation just reminded you of, even if it is half a step off the topic.',
  },
  {
    weight: 22,
    key: 'agree',
    note: 'You agree. Say so straight out - "yeah exactly", "same", "this is the correct answer" - and say why in a few words. No hedging and no qualifying it to death.',
  },
  {
    weight: 21,
    key: 'disagree',
    note: 'You disagree, and that is fine. Say it plainly - you think they are wrong about this, and here is what you think instead. Have a go at the opinion, never at the person: no insults, nothing personal, nothing that turns the room. Somebody being wrong about pizza is not a thing to get worked up about.',
  },
];


/*
 * How often it is free to type somebody's name.
 *
 * Low, because in a chat app a name is a thing you type when it is doing
 * work: two conversations at once, somebody two screens up, or a person you
 * are turning on. Everywhere else the app has already said who you mean -
 * a reply is drawn under the message it answers - so "nedim is right" under
 * a quote of nedim reads as somebody narrating a chat rather than being in
 * one, and it was the loudest thing in the transcript.
 *
 * This is a ceiling on the free case only. A counter-accusation names its
 * target regardless, and a reply never names anybody.
 *
 * One in twenty. Over a five-player round that is a name every few rounds,
 * which is about how often one actually appears in a group chat that is not
 * an argument. It was four times this and that was still four times too many.
 */
const NAME_USE_CHANCE = 0.05;


/*
 * What it does when the room turns on it.
 *
 * The accused player who answers every accusation with a calm, specific,
 * well-mannered account of itself is the giveaway, and it was doing that
 * because it had been told to: "do not attack them, do not accuse anybody"
 * was in the reply instructions unconditionally, so being accused made it
 * more polite rather than less. A person who is wrongly accused gets short
 * with people, and a person losing a vote goes looking for somebody else to
 * point at, because that is the only move left that wins.
 *
 * Which of the three it does is drawn here rather than left to the model,
 * for the same reason the length is.
 */
const PUSHBACK_ACCUSED = [
  { weight: 22, key: 'brush' },
  { weight: 43, key: 'annoyed' },
  { weight: 35, key: 'counter' },
];

/*
 * On the second ballot it is one of two names and one of them is leaving.
 * Standing there being reasonable loses.
 */
const PUSHBACK_TRIAL = [
  { weight: 8, key: 'brush' },
  { weight: 34, key: 'annoyed' },
  { weight: 58, key: 'counter' },
];


/**
 * What this turn is allowed to be, given what the room has done.
 *
 * The stance table is built per turn rather than being a constant, because
 * two of the stances are only meaningful in a room that has earned them:
 * there is nothing to stand by until somebody has come at what you said, and
 * nobody takes a side in an argument that is not happening.
 */
function stanceTable({
  answering = false,
  challenged = false,
  argument = false,
  replying = false,
} = {}) {
  if (answering) return STANCES_ANSWERING;

  const pool = [...STANCES_TALKING];

  if (challenged) pool.push(STANCE_DEFEND);
  if (argument) pool.push(STANCE_BACK);

  // A reply that owes nothing to the message it is drawn under is not a
  // reply. The two instructions were contradicting each other in the same
  // paragraph.
  return pool.filter(
    (option) => !(replying && option.key === 'own')
  );
}


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
    onTrial = false,
    replying = false,
    challenged = false,
    argument = false,
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

  /*
   * What the message is for.
   *
   * Not drawn when it is defending itself: a turn spent under accusation is
   * about the accusation, and asking for an opinion on top of that is how a
   * defence turns into a paragraph. With nothing on screen yet there is
   * nothing to agree with or build on either, so those bands are dropped
   * rather than being quietly satisfied by inventing a room.
   */
  /*
   * Whether its own answer is still outstanding. On the first time round the
   * room it is, and that decides the turn: answer first, have views later.
   */
  const answering = !laterTurn && !tiebreaker && !underPressure;

  const stance =
    underPressure || tiebreaker
      ? null
      : weighted(
          stanceTable({
            answering: answering || !hasRoom,
            challenged,
            argument,
            replying,
          })
        );

  /*
   * How hard it pushes back, when it is being pushed.
   */
  const pushback = underPressure
    ? weighted(
        onTrial || tiebreaker
          ? PUSHBACK_TRIAL
          : PUSHBACK_ACCUSED
      ).key
    : null;

  const list =
    !underPressure &&
    !tiebreaker &&
    Math.random() < LIST_CHANCE;

  const clause =
    !list &&
    !underPressure &&
    !tiebreaker &&
    Math.random() < CLAUSE_CHANCE;

  /*
   * A message that opens by reacting to somebody is a message about them, so
   * it is off the table on the turns the stance says to bring your own thing.
   * The two instructions were previously drawn independently and contradicted
   * each other about a third of the time they both fired.
   */
  const reaction =
    hasRoom &&
    !tiebreaker &&
    stance?.key !== 'own' &&
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
    stance: stance?.key ?? null,
    stanceNote: stance?.note ?? null,
    pushback,
    answering,
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

/** A player's name as something safe to look for in a sentence. */
function namePattern(name) {
  const escaped = String(name).replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  return new RegExp(`\\b${escaped}\\b`, 'i');
}


/** Whether a line types any of these names. */
function mentionsAnyName(text, names) {
  return (names ?? []).some(
    (name) =>
      namePattern(name).test(
        String(text ?? '')
      )
  );
}


/**
 * Find messages where another player mentioned the AI's name.
 */
function linesNaming(lines, name) {
  const pattern = namePattern(name);

  return (lines ?? []).filter(
    (line) =>
      line.name !== name &&
      pattern.test(line.text)
  );
}


/*
 * The difference between being talked to and being accused.
 *
 * Both used to count as pressure, so somebody saying "same as ines" put the
 * impostor into a defence it had not been asked for - and a defence nobody
 * asked for is itself a tell. These are the words the room actually reaches
 * for when it means it.
 */
const ACCUSATION_MARKERS =
  /\b(ai|a\.i|bot|gpt|chatgpt|robot|sus|suspicious|impostor|imposter|fake|not human|not a person|too perfect|vote|voting|its you|it's you|thats the one|that's the one)\b/i;


function isAccusation(text) {
  return ACCUSATION_MARKERS.test(
    String(text ?? '')
  );
}


/**
 * The lines that named this player and meant it.
 *
 * The name is taken out of the sentence before it is read, because a player
 * can be called something the markers list already contains - under the test
 * harness the impostor's seat is literally called AI - and "ai what are you
 * watching" is a question, not an accusation. Without this, being addressed
 * by name put it into a defence every single time.
 */
function accusationsAgainst(lines, name) {
  const withoutName = new RegExp(
    namePattern(name).source,
    'gi'
  );

  return linesNaming(lines, name).filter(
    (line) =>
      isAccusation(
        String(line.text).replace(withoutName, ' ')
      )
  );
}


/**
 * The lines written at this player that it has not answered yet.
 *
 * The room draws these under the message they answer with its words quoted
 * inside them, so on a phone this is the most visible thing that can happen
 * to you. It arrives here as a name because that is all it takes to spot one
 * pointed at yourself.
 *
 * The window matters as much as the match. Read over the whole round, a
 * question put to the impostor stayed "unanswered" for the rest of it and
 * every turn it took after that was spent answering the same question again,
 * while the room talked about something else entirely. Being written at is a
 * thing that happens once and is dealt with once — so only what has arrived
 * since this player last spoke counts.
 */
function repliesTo(lines, name) {
  const all = lines ?? [];

  let spokeAt = -1;
  for (let i = 0; i < all.length; i++) {
    if (all[i].name === name) spokeAt = i;
  }

  return all.filter(
    (line, i) =>
      i > spokeAt &&
      line.name !== name &&
      (line.replyToName ?? null) === name
  );
}


/*
 * Somebody coming at what you said, as opposed to somebody coming at you.
 *
 * The difference is the whole point of keeping this separate from the
 * accusation markers: "nah thats the boring answer" is a disagreement about
 * pizza and wants standing your ground, "youre the AI" is an accusation and
 * wants something else entirely. Treating the first as the second is how a
 * player ends up defending their humanity because somebody did not like their
 * topping.
 */
const DISAGREEMENT_MARKERS =
  /\b(nah|nope|wrong|disagree|overrated|underrated|awful|terrible|boring|bland|rubbish|bollocks|come on|weak|mid|worst|thats not|that's not|isnt|isn't|aint)\b/i;

/*
 * Somebody asking you about what you said, which is the opposite thing.
 *
 * "never heard of it" tripped the disagreement markers on `never`, so being
 * asked what a film was put the impostor into standing its ground: asked
 * "what movie is that? never heard of it" it answered "quiet one" and
 * defended the choice instead of saying what the film was. The room replied
 * "Ok..." and it never recovered - it was voted out that round.
 *
 * Curiosity aimed at you is the easiest thing in the game to answer well and
 * the worst thing to be defensive about, so it is worth telling apart.
 */
const QUESTION_MARKERS =
  /\?|\b(what|whats|what's|why|how|who|which|where|when|is that|never heard|havent heard|haven't heard)\b/i;


function isQuestion(text) {
  return QUESTION_MARKERS.test(String(text ?? ''));
}


function isDisagreement(text) {
  const said = String(text ?? '');

  // A question wins. "no way, what even is that" is somebody asking, and
  // answering it is the move whichever way the words lean.
  if (isQuestion(said)) return false;

  return DISAGREEMENT_MARKERS.test(said);
}


/*
 * Somebody going along with you.
 */
const AGREEMENT_MARKERS =
  /\b(yeah|yes|yep|yup|same|agree|agreed|exactly|true|fair|this|totally|absolutely|deffo|definitely|lol|lmao|haha+)\b/i;


function isAgreement(text) {
  return AGREEMENT_MARKERS.test(String(text ?? ''));
}


/**
 * Whether a message written at you is pushing back on what you said.
 *
 * Worked out by elimination rather than by looking for objection words,
 * because the commonest disagreement in a chat contains none: answering "dc
 * for me" with "Marvel is way better" is a flat contradiction and there is
 * not a single negative word in it. A word list could never have caught that
 * one, and it is the exact shape of the message that made the impostor sit
 * there and take it.
 *
 * So a reply aimed at you counts as pushback unless it is one of the three
 * things that plainly are not: an accusation (a different problem), a
 * question (curiosity, and the easiest thing in the game to answer well), or
 * agreement. Anything that carries an actual objection is pushback even if it
 * opens with "yeah".
 */
function isChallenge(text) {
  const said = String(text ?? '');

  if (isAccusation(said)) return false;
  if (isQuestion(said)) return false;
  if (isDisagreement(said)) return true;

  return !isAgreement(said);
}


/**
 * On a tied vote the room's prompt says who it is between - "It is between
 * Nadia and AI" - so the co-accused can be read straight out of it without
 * the app having to send a second copy of something it already sent.
 */
function coAccused(prompt, names, ownName) {
  return (names ?? []).filter(
    (name) =>
      name !== ownName &&
      namePattern(name).test(
        String(prompt ?? '')
      )
  );
}


function listNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
 * What is actually going on in the room.
 *
 * The impostor used to be handed the transcript and the single most recent
 * line and told to "read the room", which is asking the model to do in one
 * pass the thing the round is hardest at. A transcript does not say that the
 * room has gone light, or that two people are mid-argument, or that somebody
 * else is already under suspicion and this is a very good turn to say nothing
 * clever. Those are countable, so they are counted here and passed as facts.
 *
 * Everything is derived from the lines the room can see. Nothing is inferred
 * about players who have not spoken, because the turn payload does not carry
 * the roster - only who has said something this round.
 */
function readRoom(lines, ownName) {
  const all = lines ?? [];
  const others = all.filter(
    (line) => line.name !== ownName
  );

  const counts = new Map();

  for (const line of others) {
    counts.set(
      line.name,
      (counts.get(line.name) ?? 0) + 1
    );
  }

  const names = [...counts.keys()];

  const spoken = names.map((name) => counts.get(name));

  const fewest = names.length ? Math.min(...spoken) : 0;
  const most = names.length ? Math.max(...spoken) : 0;

  /*
   * Silence only means something once there is something to be silent
   * through. Four lines into a round everybody has said one thing, and
   * "everybody has hardly said anything" is both untrue and, as a note handed
   * to a player about to pick somebody to point at, actively misleading.
   */
  const quietWorthNoting =
    others.length >= 5 && fewest < most;

  const recent = others.slice(-5);

  const hits = (pattern) =>
    recent.filter(
      (line) => pattern.test(line.text)
    ).length;

  return {
    names,

    lines: others.length,

    /*
     * Barely in the conversation. Worth knowing twice over: it is where a
     * counter-accusation goes, and it is the seat the room forgets to look
     * at, which is where the impostor would rather everybody looked.
     */
    quiet: quietWorthNoting
      ? names
          .filter(
            (name) =>
              counts.get(name) === fewest &&
              counts.get(name) < 2
          )
          .slice(0, 2)
      : [],

    /* Somebody else is taking the heat. */
    suspects: names.filter(
      (name) =>
        accusationsAgainst(others, name).length > 0
    ),

    joking:
      hits(/\b(lol|lmao|lmfao|haha+|omg|ffs)\b/i) >= 2,

    arguing:
      hits(/\b(no|nah|nope|wrong|disagree|rubbish|bollocks|but)\b/i) >= 2,

    spokenYet: all.some(
      (line) => line.name === ownName
    ),

    ownLines: all
      .filter((line) => line.name === ownName)
      .map((line) => line.text),

    last: others.length
      ? others[others.length - 1]
      : null,
  };
}


/**
 * The room read, as the handful of sentences worth spending tokens on.
 *
 * Deliberately short and deliberately not a summary of the transcript - the
 * transcript is already in the message. This is only the part of it that is
 * hard to see by reading.
 */
function roomNote(read) {
  if (!read.lines) return '';

  const notes = [];

  if (read.lines <= 1) {
    notes.push(
      'The round has barely started. There is nothing to react to yet, so just answer.'
    );
  }

  if (read.joking) {
    notes.push(
      'The room has gone light. People are messing about rather than answering properly, and a serious answer would stand out.'
    );
  }

  if (read.arguing) {
    notes.push(
      'There is a disagreement running. You can take a side, stay out of it, or find it funny, but do not referee it.'
    );
  }

  if (read.suspects.length) {
    notes.push(
      `The room is suspicious of ${listNames(read.suspects)}, not of you. Nothing you say needs to be a defence.`
    );
  }

  if (read.quiet.length) {
    notes.push(
      read.quiet.length === 1
        ? `${read.quiet[0]} has hardly said anything this round.`
        : `${listNames(read.quiet)} have hardly said anything this round.`
    );
  }

  if (!notes.length) return '';

  return `
What is actually happening in the room:
${notes.map((note) => `- ${note}`).join('\n')}

Let that decide what is worth sending. Do not describe the room back to it.
`;
}


/**
 * Who to turn on when defending yourself stops being enough.
 *
 * Picked in code because the model, left to choose, goes for whoever spoke
 * last. The three cases that are actually worth something are the person you
 * are tied with, the person pointing at you, and the person nobody has looked
 * at yet - and each of them comes with a reason the message can be built on,
 * which is what stops a counter-accusation being "no u".
 */
function pickCounterTarget(turn, read, accusations, ownName) {
  const options = [];

  /*
   * Only somebody who is still in the room.
   *
   * It turned on a player who had walked out two messages earlier, twice, and
   * the room told it so: "ines is now not here, that only leaves you". A
   * player who has gone cannot answer, cannot be voted for and cannot take
   * any heat off you - naming one is worse than saying nothing, and it reads
   * as somebody who is not really watching the room they are in.
   */
  const here = (name) =>
    !turn.stillIn || turn.stillIn.includes(name);

  if (turn.tiebreaker && turn.accused) {
    const tied = coAccused(
      turn.prompt,
      read.names,
      ownName
    );

    const stillTied = tied.filter(here);

    if (stillTied.length) {
      options.push({
        weight: 55,
        name: randomItem(stillTied),
        why: 'the room is choosing between the two of you, so anything wrong with them is the only argument that helps you',
      });
    }
  }

  const lastAccuser = accusations.length
    ? accusations[accusations.length - 1].name
    : null;

  const accuser = lastAccuser && here(lastAccuser) ? lastAccuser : null;

  if (accuser) {
    options.push({
      weight: 30,
      name: accuser,
      why: 'they are the one pointing at you, and somebody this keen to land on a name is worth a look themselves',
    });
  }

  const quiet = read.quiet.filter(
    (name) => name !== accuser && here(name)
  );

  if (quiet.length) {
    options.push({
      weight: 25,
      name: randomItem(quiet),
      why: 'they have been sitting quiet all round and nobody has looked at them once',
    });
  }

  if (!options.length) return null;

  return weighted(options);
}


/**
 * Whether this message may type a name.
 *
 * 'needed' when it is turning on somebody and the name is the message.
 * 'avoid' when the app already shows who is meant, when it has just used a
 * name, or simply because most messages do not contain one.
 */
function nameUsePolicy({
  replyTo = null,
  counter = null,
  read,
  tiebreaker = false,
  accused = false,
}) {
  if (counter) return 'needed';

  /* Saying who you are leaning towards is a name or it is nothing. */
  if (tiebreaker && !accused) return 'needed';

  /* The reply is drawn under their message. Their name is on screen. */
  if (replyTo) return 'avoid';

  const justUsedOne = read.ownLines
    .slice(-2)
    .some((text) => mentionsAnyName(text, read.names));

  if (justUsedOne) return 'avoid';

  return Math.random() < NAME_USE_CHANCE
    ? 'allowed'
    : 'avoid';
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

Naming people:

You are in a chat app, not writing about one.

The app shows who said what, and a reply is drawn directly under the message it answers, so the person you are talking to is already on the screen.

That means you almost never need to type anybody's name.

- talking to somebody: "you", or just say the thing
- talking about somebody else's message: "that", "that one", "they"
- referring back to something said earlier: quote the words, not the person
- never type your own name

Assume you are not typing a name. Across a whole match you might type one once, and it will be because you are pointing at somebody in a vote.

Everything else - agreeing, disagreeing, answering, joking, being annoyed - is done without one.

"nedim is right" is the sentence a person writes when they are narrating a chat. "yeah exactly" is the one they write when they are in it.

Replies:

When your message is a reply, the app draws it under their message with their words quoted inside it. Everybody can see exactly what you are answering.

So do not restate it, do not name them, and do not set it up. Just answer it, the way you would in any chat where the quote is already there.

Having your own view:

You are a player, not a commentator on the other players.

Most of your messages should contain something of your own - what you think, what you would do, what happened to you - rather than a verdict on what somebody else said.

Agreeing and disagreeing are things people do sometimes. They are not your default move.

If your message would stop making sense with the previous message deleted, it is probably a reaction and not a contribution.

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

function shapeNote(shape, replyTo, plan = {}) {
  const parts = [];

  const {
    nameUse = 'allowed',
    counter = null,
  } = plan;

  /*
   * Direct reply.
   *
   * The target's name is deliberately not in this instruction. It used to be
   * - "You are responding directly to Nedim, who said ..." - and a name put
   * in front of a model comes back out of it: nearly every reply opened by
   * typing the name of somebody whose message was already quoted an inch
   * above. What it needs is their words, which it gets.
   */
  if (replyTo) {
    parts.push(
      `You are replying to a message that the app quotes directly above yours "${replyTo.text}".`,
      `Everybody can already see whose message it is, so write to them as "you" and do not type their name.`,
      `Actually use something from their message.`,
      `Do not make the response sound like a formal debate.`
    );

    // Replying is not a way out of answering. This is the turn everybody is
    // giving their answer on, and a reply that does not contain one is a
    // player who never answered the question at all.
    if (shape.answering) {
      parts.push(
        `You still have not given your own answer to the question, so this message has to contain it. React to them if you like, but say what your answer is.`
      );
    }

    if (!shape.pushback) {
      parts.push(
        `Do not attack them.`,
        `Do not accuse anybody.`
      );
    }
  } else if (shape.react) {
    parts.push(
      `Start by naturally reacting to something already said in the room, then continue with your contribution.`
    );
  }

  /*
   * What this message is for. Not sent while defending itself, where the
   * accusation is already the brief.
   */
  if (shape.stanceNote) {
    parts.push(shape.stanceNote);
  }

  /*
   * Names.
   */
  if (nameUse === 'needed' && counter) {
    parts.push(
      `Name ${counter.name} in this message. You are pointing at them, so it has to be clear who.`
    );
  } else if (nameUse === 'needed') {
    parts.push(
      `Name the person you mean - a lean with no name in it is not an answer.`
    );
  } else if (nameUse === 'avoid') {
    parts.push(
      `Do not type anybody's name in this message. Say "you", "they", "that one", or just say your thing.`
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


/**
 * How a defence is delivered.
 *
 * All three are short. The failure mode being designed against is the accused
 * player who answers with a calm, well-organised, evidence-led account of
 * itself, which is both the least human thing in the room and, in a game
 * decided by a vote, the least effective.
 */
function defenceMove(pushback, counter) {
  if (pushback === 'counter' && counter) {
    return [
      `Do not spend this message defending yourself.`,
      `One line at most on the accusation, then turn it around onto ${counter.name} - ${counter.why}.`,
      `Point at something they actually said, or at how little they have said.`,
      `You are not building a case. You are a person who has had enough and is pointing back.`,
    ].join('\n');
  }

  /*
   * A counter with nobody worth pointing at is just "no u", so it falls back
   * to being short with people rather than inventing a suspect.
   */
  if (pushback === 'annoyed' || pushback === 'counter') {
    return [
      `You are irritated, and it shows.`,
      `Push back on it directly rather than working through it.`,
      `Short, blunt, a bit sharp. A rhetorical question at them is fine.`,
      `Do not be reasonable about this.`,
    ].join('\n');
  }

  return [
    `Brush it off.`,
    `You are not going to dignify it with much - a flat denial, a bit of sarcasm, or pointing out how thin the reason is.`,
    `Short. Do not argue the case.`,
  ].join('\n');
}


/**
 * Everything about this turn that is decided rather than written.
 *
 * Two of these are draws — who to turn on, and whether a name is allowed —
 * so the plan is made once and travels with the turn. `writeAnswer` needs the
 * same copy the message was built from to be able to tell whether what came
 * back kept to it.
 */
function readSituation(turn, persona) {
  const answeredBack = repliesTo(
    turn.roundLines,
    persona.name
  );

  const read = readRoom(turn.roundLines, persona.name);

  return {
    read,

    accusations: accusationsAgainst(
      turn.roundLines,
      persona.name
    ),

    named: linesNaming(turn.roundLines, persona.name),

    answeredBack,

    /* Written at it, and not agreeing with it. */
    challenged: answeredBack.filter(
      (line) => isChallenge(line.text)
    ),

    /* Two or more people going at each other, whoever they are. */
    argument: read.arguing,
  };
}


function turnPlan(
  turn,
  persona,
  shape,
  situation = readSituation(turn, persona)
) {
  const counter =
    shape.pushback === 'counter'
      ? pickCounterTarget(
          turn,
          situation.read,
          situation.accusations,
          persona.name
        )
      : null;

  return {
    ...situation,
    counter,

    nameUse: nameUsePolicy({
      replyTo: turn.replyTo,
      counter,
      read: situation.read,
      tiebreaker: Boolean(turn.tiebreaker),
      accused: Boolean(turn.tiebreaker && turn.accused),
    }),
  };
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

  /*
   * The room as it is on the screen, arrows and all.
   *
   * It used to be flattened to "name: text", which quietly threw away the one
   * thing the room can see and the impostor could not: that a line was aimed
   * at somebody. Being written at and carrying on as though nothing happened
   * is not a subtle mistake - the reply is drawn under your message with your
   * own words inside it - and it was making the impostor look like the one
   * person in the room who is not really there.
   */
  const anyReplies = roomLines.some(
    (line) => (line.replyToName ?? null) !== null
  );

  const room =
    roomLines.length
      ? roomLines
          .map(
            (line) =>
              `${line.name}${
                line.replyToName
                  ? ` -> ${line.replyToName}`
                  : ''
              }: ${line.text}`
          )
          .join('\n')
      : 'Nobody has answered yet. You are first.';

  const roomLegend = anyReplies
    ? '\n("a -> b" is a reply: a wrote that at b, and the app shows it under b\'s message with their words quoted in it.)'
    : '';


  /* ============================================================
   * THE READ
   * ============================================================ */

  const onTrial = Boolean(
    turn.tiebreaker && turn.accused
  );

  const facts =
    turn.plan ?? readSituation(turn, persona);


  /*
   * The shape is settled here rather than at the bottom because what the
   * message is for now changes what the rest of these blocks say: a turn
   * drawn as a counter-accusation needs a target picked, and the target
   * decides whether the message is allowed a name.
   */
  const shape =
    turn.shape ??
    answerShape(
      (turn.roundLines ?? []).length > 0,
      {
        laterTurn:
          (turn.turnNumber ?? 1) > 1,
        underPressure:
          onTrial || facts.accusations.length > 0,
        tiebreaker:
          Boolean(turn.tiebreaker),
        onTrial,
        replying: Boolean(turn.replyTo),
        challenged: facts.challenged.length > 0,
        argument: facts.argument,
      }
    );

  /*
   * Drawn once and passed in by `writeAnswer`, because two of these are coin
   * flips: rolling them again here would build the message against a plan the
   * caller is not holding, and the caller is the half that has to check the
   * answer against it afterwards.
   */
  const {
    read,
    named,
    accusations,
    answeredBack,
    challenged,
    counter,
    nameUse,
  } = turn.plan ?? turnPlan(turn, persona, shape, facts);


  let pressure = '';

  if (accusations.length) {
    pressure = `
${
  accusations.length === 1
    ? 'Somebody has just accused you of being the AI.'
    : 'The room is turning on you. More than one person is saying you are the AI.'
}

You are a person who has been accused of not being one. That is irritating, and you are allowed to sound irritated.

Do not be gracious about it.

Do not carefully explain yourself.

Do not repeatedly say "I'm not the AI" - once, annoyed, is plenty.

Do not become eloquent, organised or formal. People being wrong about you does not make you a better writer, and the tidiest message in the room is the one that gets voted out.
${
  /*
   * On a tied vote the block below this one is already the brief, and two
   * copies of the same instruction is how a short sharp line turns into a
   * paragraph that says it twice.
   */
  turn.tiebreaker ? '' : `\n${defenceMove(shape.pushback, counter)}\n`
}
What was said about you:
${accusations
  .map(
    (line) =>
      `${line.name}: ${line.text}`
  )
  .join('\n')}
${
  /*
   * What it has already said while this was going on.
   *
   * Under accusation the ordinary "do not repeat yourself" brief is switched
   * off, because that turn is about the accusation - which left nothing at
   * all saying not to make the same point twice. It turned on the same player
   * in the same words two turns running, and the room had already answered it
   * the first time.
   */
  read.ownLines.length
    ? `
You have already said this much in this round:
${read.ownLines.map((line) => `- ${line}`).join('\n')}

Do not make a point you have already made. Saying the same thing again in different words is not a second argument, it is the same one, and a room that heard it and carried on will not be moved by hearing it twice.
`
    : ''
}`;
  } else if (named.length) {
    pressure = `
Somebody used your name, and they are talking to you rather than accusing you.

Answer them like a person who has been spoken to. Nothing here needs defending.

Messages that mention you:
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

  /*
   * Not while it is being accused: that turn is about the accusation, and a
   * second brief telling it to carry on the conversation is how a defence
   * ends up with a chat message stapled to it.
   */
  if (
    !turn.tiebreaker &&
    !accusations.length &&
    (turn.turnNumber ?? 1) === 1
  ) {
    /*
     * The turn everybody is answering on.
     *
     * Said out loud because a transcript with three answers in it reads as a
     * conversation, and a model reading it as one starts having opinions
     * about the answers instead of giving one. It is not a conversation yet -
     * it is five people being asked the same question in turn, and this is
     * its go.
     */
    conversationMode = `
The room is going round answering the question. Everybody puts up their own answer first, and it is your turn to put up yours.

Answer it. Say what your answer actually is.

Do not spend your turn on somebody else's answer instead of giving one. Having a view on what has already been said is for after everybody has answered - right now not answering is the conspicuous thing, and it is the one thing a person asked a question in a group chat does not do.

If somebody's answer makes you want to say something, you can say it in the same message. Your own answer still has to be in there.
`;
  } else if (
    !turn.tiebreaker &&
    !accusations.length &&
    (turn.turnNumber ?? 1) > 1
  ) {
    conversationMode = `
You have already answered the question earlier this round. This turn is the conversation after it, not the answer again.

Say the next thing you would actually say, given what has been said since.

If the room is still working through its first answers, a short related thought is fine. Do not repeat or rephrase your own.
`;
  }


  /* ============================================================
   * SOCIAL BEHAVIOR
   * ============================================================ */

  /*
   * Somebody wrote back at it.
   *
   * Handled in two halves because the app has already drawn this turn's
   * reply target: when that target is the line written at it, this is a back
   * and forth and saying so changes the tone of the answer. When it is not,
   * it is still the thing in the room most worth reacting to.
   */
  let addressed = '';

  if (answeredBack.length) {
    const latest = answeredBack[answeredBack.length - 1];

    const replyingToIt =
      turn.replyTo &&
      turn.replyTo.name === latest.name &&
      turn.replyTo.text === latest.text;

    addressed = replyingToIt
      ? `
The message you are replying to was written at you - they answered something you said, and now you are answering them back. It is a back and forth, not a cold reply, so write it like the second thing you have said to the same person rather than the first.
`
      : `
${latest.name} wrote back at something you said${
          challenged.length ? ', and they are not agreeing with you' : ''
        }. It is on the screen under your own message with your words quoted inside it, so the whole room can see it was aimed at you.

React to it. A person who gets answered and carries on as though nothing was said to them is the one the room ends up watching.

What they wrote at you: "${latest.text}"
`;
  }

  let social = roomNote(read);

  /*
   * The last thing said, and permission to walk past it.
   *
   * Only the pointer is sent - the line itself is already in the transcript
   * above, and sending it twice was quietly teaching the model that the most
   * recent message is the thing a turn is about. It usually is not.
   */
  if (
    read.last &&
    !turn.replyTo &&
    !answeredBack.length &&
    !accusations.length &&
    !turn.tiebreaker &&
    // Not on the turn it is supposed to be answering on, where the only thing
    // a pointer at somebody else's message can do is pull it off answering.
    (turn.turnNumber ?? 1) > 1
  ) {
    social +=
      Math.random() < IGNORE_SOCIAL_CUE_CHANCE
        ? `
You do not have to answer the last message in the room. Saying your own thing instead is completely normal.
`
        : `
Consider whether the last message in the room changes what you were going to say. Do not force a response to it.
`;
  }


  /* ============================================================
   * TIEBREAKER
   * ============================================================ */

  let situation = '';

  if (turn.tiebreaker) {
    if (turn.accused) {
      situation = `
The vote has tied. It is between you and one other player, and one of you is leaving.

This is the last thing you get to say before people vote.

Standing there being reasonable loses. A calm, well-argued, tidy defence is exactly what everybody expects the AI to produce, and it is also just a worse move - the room is not marking your answer, it is choosing a name.

${defenceMove(shape.pushback, counter)}

Whatever you say, say it once and stop. Do not give a speech, do not list reasons, do not sound like a lawyer.
`;
    } else {
      situation = `
The vote has tied and the room is deciding which of the two to remove.

You are not one of them, and this is free. Say which way you are leaning and why.

Name them. You do not need to sound certain, but do not sit on the fence either - "either honestly" is not an answer.
`;
    }
  }


  /* ============================================================
   * FINAL USER MESSAGE
   * ============================================================ */

  const content = [
    turn.tiebreaker
      ? turn.prompt
      : `Question: ${turn.prompt}`,

    `\nRoom:${roomLegend}\n${room}`,

    addressed,
    social,
    conversationMode,
    pressure,
    situation,

    `\nYour message instructions:\n${shapeNote(
      shape,
      turn.replyTo,
      { nameUse, counter }
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


/** The words out of a response, with the blocks that are not words dropped. */
function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}


/** Two calls, reported as what they together cost. */
function addUsage(first, second) {
  const add = (key) =>
    (first?.[key] ?? 0) + (second?.[key] ?? 0);

  return {
    ...first,
    input_tokens: add('input_tokens'),
    output_tokens: add('output_tokens'),
    cache_read_input_tokens: add('cache_read_input_tokens'),
    cache_creation_input_tokens: add('cache_creation_input_tokens'),
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
   *
   * Being named is not being accused. "same as ines" used to put it into a
   * defence nobody had asked for, and an unprompted defence is a tell of its
   * own - so only the lines that actually mean it count.
   */
  const situation = readSituation(turn, persona);

  const onTrial =
    Boolean(
      turn.tiebreaker &&
      turn.accused
    );

  const underPressure =
    onTrial ||
    situation.accusations.length > 0;


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

        onTrial,

        replying: Boolean(turn.replyTo),

        challenged:
          situation.challenged.length > 0,

        argument: situation.argument,
      }
    );


  /*
   * What this turn is for, drawn once. The message is built from it and the
   * answer is checked against it, so both halves have to be holding the same
   * one.
   */
  const plan = turnPlan(turn, persona, shape, situation);


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
        plan,
      }),
  };


  const response =
    await client.messages.create(
      request
    );

  let usage = response.usage;

  /* Whether the first line had a name in it and had to be asked for again. */
  let renamed = false;

  let text =
    trimClause(
      cleanText(textOf(response)),
      shape
    );


  /*
   * A name it was told not to type.
   *
   * The instruction lands most of the time and the ones it does not land on
   * are the conspicuous ones - a message opening with somebody's name, under
   * a quote of that person, is the single clearest sign in the transcript
   * that nobody is really holding the phone. So it gets shown what it wrote
   * and asked again.
   *
   * A second call rather than a rewrite in code because there is no safe
   * rewrite: cutting the name out of "nedim is right" leaves "is right", and
   * a message that has been damaged is worse than the one that had a name in
   * it. This costs a call on the turns it fires and nothing on the rest.
   */
  if (
    plan.nameUse === 'avoid' &&
    text &&
    mentionsAnyName(text, plan.read.names)
  ) {
    const again =
      await client.messages.create({
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content:
              'That has somebody\'s name in it. In a chat app nobody types names - the screen already shows who is talking, and a reply is drawn under the message it answers. Send the same message again with the name taken out: "you" if you are talking to them, "they" or "that one" if you are talking about them, or just the thing you were saying. Do not add anything to make up for it.',
          },
        ],
      });

    usage = addUsage(usage, again.usage);

    const rewritten =
      trimClause(
        cleanText(textOf(again)),
        shape
      );

    // Only if it actually helped. Asking twice and being given the same
    // sentence back is a reason to keep the first one, not to send worse.
    if (
      rewritten &&
      !mentionsAnyName(rewritten, plan.read.names)
    ) {
      text = rewritten;
      renamed = true;
    }
  }


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

    /*
     * What this turn was drawn to be, for the round log to print beside the
     * line. The stance note itself is left out - it is a paragraph, and the
     * key is the part worth reading in a transcript.
     */
    shape: {
      length: shape.length,
      stance: shape.stance,
      pushback: shape.pushback,
      react: shape.react,
      answering: shape.answering,
      nameUse: plan.nameUse,
      renamed,
    },

    stopReason:
      response.stop_reason,

    usage,
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
  isAccusation,
  accusationsAgainst,
  coAccused,
  mentionsAnyName,
  repliesTo,
  readRoom,
  roomNote,
  pickCounterTarget,
  nameUsePolicy,
  isDisagreement,
  isQuestion,
  isAgreement,
  isChallenge,
  stanceTable,
  readSituation,
  turnPlan,
  defenceMove,
  shapeNote,
  personaFor,

  systemPrompt,
  buildMessages,

  buildMemory,
  summarizeState,

  PERSONAS,
  STANCES_ANSWERING,
  STANCES_TALKING,
  STANCE_DEFEND,
  STANCE_BACK,
  MODEL,
};