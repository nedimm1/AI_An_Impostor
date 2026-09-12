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

const { OpenRouter } = require('./openrouter');

/**
 * The model, on OpenRouter.
 *
 * The paid copy, deliberately. `:free` is not a discount on this, it is a
 * different route: one provider - Google AI Studio's shared allowance - which
 * answers 429 rather than queueing when it is busy, which it continuously is.
 * On top of that the platform caps free models at 50 requests a day across
 * all of them, and a match makes ~16 calls. Three matches a day, badly.
 *
 * It used to default to `:free`, which meant the only thing keeping the game
 * on the working route was a line in somebody's `.env` - and the failure is
 * silent, since the room falls back to a stock line when a turn cannot be
 * written. A machine without that file played a whole match of stock lines
 * and looked like a prompt problem.
 *
 * Set OPENROUTER_MODEL to override. `google/gemma-4-31b-it:free` is the
 * emergency route if the credit runs out - it plays, badly.
 */
const MODEL = process.env.OPENROUTER_MODEL ?? 'google/gemma-4-31b-it';

/**
 * Models to try when the first one is rate-limited, in order.
 *
 * Empty by default — a second model is a second voice, and a match where the
 * impostor changes writing style halfway through is worse than one where it
 * occasionally sends a stock line. Set it when you would rather have a turn
 * than have it consistent.
 *
 *   export OPENROUTER_FALLBACK_MODELS=google/gemma-4-26b-a4b-it:free
 */
const FALLBACKS = (process.env.OPENROUTER_FALLBACK_MODELS ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

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
/*
 * Weighted off what the room actually types.
 *
 * Counted over two real matches, the four human seats came out at roughly a
 * third under four words, a third in the middle, and a third at eight or
 * more - "I feel like ur just jealous because shes more productive than u",
 * "You have no evidence against me, that makes me think its you", "First
 * defending kofi, now this, you are really sus man". The old weights put
 * seventy per cent of the impostor's messages at seven words or fewer, so
 * next to that room it was the seat that never said anything of any length,
 * which is a shape you can see from across the transcript.
 */
const LENGTHS = [
  { weight: 24, min: 1, max: 3, label: 'one to three words' },
  { weight: 32, min: 4, max: 7, label: 'four to seven words' },
  { weight: 28, min: 8, max: 13, label: 'eight to thirteen words' },
  { weight: 12, min: 14, max: 20, label: 'fourteen to twenty words' },
  { weight: 4, min: 21, max: 30, label: 'twenty to thirty words' },
];

/*
 * Deliberately lower than the old implementation.
 *
 * If nearly half the messages contain a typo/apostrophe trick,
 * the pattern itself becomes suspicious.
 */
const IMPERFECTION_CHANCE = 0.3;

/*
 * How much of that imperfection is a letter-level slip.
 *
 * Everything here used to be apostrophes, and the model writes without them
 * anyway on the style rules it is given, so in practice nothing ever
 * happened: every line it sent was spelled perfectly. In one real round the
 * other four seats typed "sicence", "typ", "dosent" and "icebregg" - and
 * lowercase with no full stops is a style anybody can adopt, while never
 * once mistyping a word over a whole match is a machine.
 */
const TYPO_CHANCE = 0.55;

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
 *
 * How often depends on how much is being said, because that is what a comma
 * is for. Three words do not need one and twelve usually do: of the human
 * messages in a real match that ran to eight words or more, getting on for
 * half had a comma in them, and none of the short ones did.
 */
function clauseChanceFor(length) {
  if (length.max <= 3) return 0.08;
  if (length.max <= 7) return 0.25;
  if (length.max <= 13) return 0.45;
  return 0.6;
}

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

/*
 * Bringing your own thing, when your own answer is the thing you have not
 * brought yet.
 *
 * The room moved past the question before this seat ever answered it, so the
 * most interesting thing it has is still sitting there unsaid. Same move as
 * `own` - say something of your own - except there is an obvious candidate,
 * and it goes into the conversation rather than over the top of it.
 */
const STANCE_OWN_UNANSWERED = {
  weight: 30,
  key: 'own',
  note: 'You still have not said what your own answer to the question is, and it is the thing you have that nobody has heard. Say it now, into what the room is actually talking about - what you think and why, aimed at what is being said, not posted over the top of it as though nobody had spoken.',
};

/*
 * The two moves the room's own suspicion puts on the table.
 *
 * When somebody gets called the impostor, that is the conversation - a vote
 * is a minute away and a name is in the frame. It had no way to say anything
 * about that: the read produced "the room is suspicious of Nadia, not of
 * you", which is a prohibition and nothing else, and the stance it drew on
 * top told it to say something of its own. So with Priya having just named
 * Nadia and Jonas agreeing, it sent "rude is just how some people type" - a
 * generalisation about typing, from the one seat in the room with a stake in
 * where this lands. Nobody in a group chat watches a name go up and offers a
 * remark about typing styles.
 *
 * Both directions are here because both are human and only one of them is
 * obviously good for it. Agreeing is worth a lot and doubting is worth
 * something too: the player who backs every accusation is its own pattern,
 * and a room that has been wrong once remembers who pushed.
 */
const STANCE_PILE_ON = {
  weight: 30,
  key: 'pile',
  note: 'Somebody has just been called the impostor. Say what you think of that - whether you buy it, and the actual thing they said that looks off, in their words. You are voting in a minute and this is you making your mind up out loud, not reporting on what other people reckon.',
};

const STANCE_DOUBT = {
  weight: 18,
  key: 'doubt',
  note: 'Somebody has just been called the impostor and you are not convinced. Say so, and point at the actual thing that makes them look like a person - a message they sent, in their words, not a category of behaviour. Say it the way you would say it to a mate: "nah hes not the bot", "that sounds like a person to me". Not "reads real to me" - you are in a chat, not reviewing the evidence. Push back on the read, do not lecture the room about being fair.',
};

const STANCES_TALKING = [
  {
    weight: 24,
    key: 'own',
    /*
     * This used to end "something that would still have existed if nobody
     * had spoken", which was aimed at the player who only ever rates other
     * people - and which describes, exactly, a sentence with no connection
     * to the room. What came back was general truths: "rude is just how some
     * people type", "rude isnt a tell". Bringing something of your own and
     * saying something that would fit in any chat on any day are not the
     * same instruction, and the old wording asked for the second one.
     */
    note: 'Bring something of your own rather than a verdict on somebody else - what you think, what you would do, what happened to you once. About this, here, now.',
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
  unanswered = false,
  suspicion = false,
  piling = false,
} = {}) {
  if (answering) return STANCES_ANSWERING;

  let pool = [...STANCES_TALKING];

  /*
   * A name is in the frame. Adding something of your own to the topic is
   * still a thing people do, but wandering off it - a tangent, or building
   * out the original question - is what somebody who is not following the
   * room does, and that is the whole of what it was doing.
   */
  if (suspicion) {
    pool = pool.filter(
      (option) => option.key !== 'tangent' && option.key !== 'build'
    );
  }

  /*
   * It owes the room an answer and the room has stopped waiting for one.
   * Saying its own thing is saying its answer, and a tangent from the one
   * person who never answered is the worst of both.
   */
  if (unanswered) {
    pool = pool
      .filter((option) => option.key !== 'tangent')
      .map((option) =>
        option.key === 'own' ? STANCE_OWN_UNANSWERED : option
      );
  }

  /*
   * A room mid-argument is a room where having a view is the whole of the
   * conversation. Wandering off onto something the argument reminded you of
   * is the one thing nobody in an argument does, and the person who does it
   * is not in the argument.
   */
  if (argument) {
    pool = pool
      .filter((option) => option.key !== 'tangent')
      .map((option) =>
        option.key === 'disagree'
          ? {
              ...option,
              weight: Math.round(option.weight * 1.4),
            }
          : option
      );
  }

  if (challenged) pool.push(STANCE_DEFEND);
  if (argument) pool.push(STANCE_BACK);

  if (suspicion) {
    pool.push(STANCE_PILE_ON);

    /*
     * Standing up for the person the room has settled on is how you become
     * the alternative to them.
     *
     * It did exactly this and lost the match on it: two people had put
     * Nedim's name up, and it spent both of its remaining turns on his side
     * - "yeah kofi was clean", then defending him again - and the two who
     * were accusing him voted for it instead. Against one person's theory,
     * taking the other side is ordinary and costs nothing. Against a room
     * that has converged, it pairs you with the name that is already up.
     *
     * Still possible, because people do defend their friends into a losing
     * vote, and a seat that never once does is its own pattern.
     */
    pool.push(
      piling
        ? { ...STANCE_DOUBT, weight: 6 }
        : STANCE_DOUBT
    );
  }

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

/** The one-to-three-word band, which is the only one anything takes off. */
function shortest(bands) {
  return bands.find((band) => band.max <= 3);
}

/**
 * Hold the shortest band down to `target`, and give what was taken to the
 * band directly above it rather than back to the room.
 *
 * Three guards below take that band away - a later turn, a defence, and
 * having just sent something short - and each is right on its own terms. What
 * none of them meant was for the message to get *longer*, and that is what
 * was happening: `weighted` spreads a missing weight across whatever is left
 * in proportion, so zeroing the shortest band handed a quarter of every draw
 * to the three long ones. Drawn over a round it moved the share of answers at
 * seven words or fewer from 56% on the first turn to 42% by the third, and
 * the seat that starts out in the chat ends up writing to the room.
 *
 * Moving it one band up keeps every guard doing the job it was added for -
 * nothing telegraphic where they said so - while leaving the answer as short
 * as it was otherwise going to be. The room still gets long messages; it gets
 * them at the rate the counted transcripts had them, rather than at whatever
 * rate falls out of the guards stacking.
 */
/**
 * Drop every band at or under `words` and hand the weight to the next one up.
 *
 * `capShortest` leans on the shortest band; this removes a floor outright,
 * which only the bits need. Same principle either way - weight taken off the
 * bottom goes up one step, never out into the long tail.
 */
function raiseFloor(bands, words) {
  let moved = 0;

  const raised = bands.map((band) => {
    if (band.max > words) return band;

    moved += band.weight;

    return { ...band, weight: 0 };
  });

  if (moved === 0) return bands;

  let given = false;

  return raised.map((band) => {
    if (band.max > words && !given) {
      given = true;

      return { ...band, weight: band.weight + moved };
    }

    return band;
  });
}


function capShortest(bands, target) {
  const short = shortest(bands);

  if (!short || short.weight <= target) return bands;

  const moved = short.weight - target;
  let given = false;

  return bands.map((band) => {
    if (band.max <= 3) return { ...band, weight: target };

    // The bands are in ascending order, so this is the four-to-seven one.
    if (!given && band.min >= 4) {
      given = true;
      return { ...band, weight: band.weight + moved };
    }

    return band;
  });
}

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
    talking = false,
    suspicion = false,
    piling = false,
    terse = false,
    inCharacter = false,
    needsRoom = false,
  } = {}
) {
  let bands = [...LENGTHS];


  /*
   * A character needs room to be one.
   *
   * Measured across the six bits, every line that came out flat came out of
   * the shortest band: the conspiracy theorist answered "sushi", the
   * commentator "nah you're wrong", the victorian gentleman defended himself
   * with "sir". Two words cannot carry a voice, so the bit quietly switched
   * off for that turn - which is the one thing a bit must never do, an eight
   * message pirate who sends one plain message being more conspicuous than
   * no pirate at all.
   *
   * The bits that survived a short draw were the ones whose marker is itself
   * short - "arr", "uwu", "que?". Rather than write the other three around
   * that, the band goes.
   */
  if (inCharacter) {
    bands = raiseFloor(bands, 3);

    /*
     * Three of the bits are a frame around the answer rather than a way of
     * saying it. "who benefits" fits in four words; narrating your own answer
     * like a match, explaining who the data harvest serves, or getting your
     * star sign into it does not - and on a short draw those three came out
     * as "you just want it boring", "you just dont know sauces lol" and a
     * bare "tacos", which is the bit off again.
     *
     * Astrology is here for the first turn especially. Cold room, nothing to
     * react to, and the model answered the question and dropped the frame
     * two times out of three - which is the worst message in the match to
     * drop it on, being the one that establishes there is a bit at all.
     */
    if (needsRoom) {
      bands = raiseFloor(bands, 7);
    }
  }



  /*
   * Later turns should generally have a little more substance.
   */
  if (laterTurn) {
    bands = capShortest(
      bands,
      Math.max(8, Math.floor(shortest(bands).weight * 0.35))
    );
  }

  /*
   * Accusations need enough room to actually defend itself.
   */
  if (underPressure || tiebreaker) {
    bands = capShortest(bands, 0);
  }

  /*
   * Not two one-word turns in a row.
   *
   * Applied last, because the later-turn adjustment above floors this band
   * rather than clearing it and would put it straight back.
   *
   * The shortest band is a third of all draws and it is the right length for
   * plenty of chat messages - but drawn twice running it produces a seat
   * that sends "yeah exactly" and then "yeh exactly" while the room has an
   * argument going on around it. One of those is a person agreeing. Two is
   * somebody who is not really here, and the room notices the second one.
   */
  if (terse) {
    bands = capShortest(bands, 0);
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
   * room it is, and that used to decide the turn on its own: answer first,
   * have views later.
   *
   * It is not enough on its own, because the question at the top is a
   * conversation starter rather than a roll call. If the room has already
   * stopped going round it - somebody answered, somebody else had a view
   * about that answer, and now two people are going at it - then the turn is
   * that conversation, and the player who posts a cold answer into the
   * middle of it is the one who reads as not having been in the room.
   *
   * So the room decides, and owing an answer only means answering while
   * answering is what everybody is doing.
   */
  const owesAnswer =
    !laterTurn && !tiebreaker && !underPressure;

  const answering = owesAnswer && !talking;

  const stance =
    underPressure || tiebreaker
      ? null
      : weighted(
          stanceTable({
            answering: answering || !hasRoom,
            challenged,
            argument,
            replying,
            unanswered: owesAnswer && talking,
            suspicion,
            piling,
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

  /*
   * Not on the turn it is answering on.
   *
   * Asked for a favourite food in a room where everybody named one thing -
   * PB and J, peking duck, doner kebab - it answered "katsu curry, ramen,
   * anything w rice". Three options and a category is not an answer, it is a
   * refusal to pick, and picking is the whole of what everybody else did.
   */
  const list =
    !answering &&
    !underPressure &&
    !tiebreaker &&
    Math.random() < LIST_CHANCE;

  const clause =
    !list &&
    !underPressure &&
    !tiebreaker &&
    Math.random() < clauseChanceFor(length);

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

  /*
   * Only ever on a short message.
   *
   * This is here because a model asked for three words writes three words
   * and then a comma and an explanation, which is how a chat message turns
   * into a sentence with a footnote. On a long message it is doing the
   * opposite: everything after the first comma was being cut off four times
   * out of five, so "nah, thats not it" went out as "nah" and a twelve-word
   * message came back as its first clause. Every long line the room saw was
   * comma-free by construction, which is not a thing people write.
   */
  if (shape.words && shape.words[1] >= 8) {
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

  let result = String(text).trim();

  /*
   * A wrapping pair only.
   *
   * The lead quote used to be stripped on its own, unconditionally, which
   * was fine while nothing it wrote had a quote inside it. Now that it is
   * told to quote what people actually said, most of its sharper lines do -
   * and the room was shown `incel alert" is too mean for a bot`, with an
   * orphan quote mark sitting in the middle of it. Nobody types that, and it
   * is the sort of thing a person reads twice.
   *
   * So the pair comes off when the whole message is inside it and nothing in
   * the middle reopens it, and otherwise the quotes are the model's and are
   * left alone.
   */
  const edge = result[0];

  if (
    (edge === '"' || edge === "'") &&
    result.length > 1 &&
    result.endsWith(edge) &&
    !result.slice(1, -1).includes(edge)
  ) {
    result = result.slice(1, -1).trim();
  }

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
   * And quotation marks.
   *
   * Once it was told to point at what people actually said it started
   * doing it in typography - `"you have no evidence" reads real to me` -
   * and nobody in a group chat punctuates a quote. They just say the words.
   * The app is already drawing a reply under the message it answers with
   * those words inside it, so a second pair of quotes around them is a
   * person writing about a conversation rather than being in one. It was
   * the last thing this seat sent before the room voted it out.
   */
  result = result.replace(/["\u201c\u201d]/g, '');

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
 * THE BIT
 * ============================================================ */

/*
 * Occasionally it turns up doing a character, and keeps it all match.
 *
 * This exists because it is what the room does. A player who wants to prove
 * they are not a bot has one reliable move - be far too strange to be one -
 * and so rooms contain uwu girls, pirates, and people conducting the entire
 * match in Spanish. Those seats are almost never voted out, because the
 * suspicion in this game runs on "would a machine write that", and a machine
 * plainly would not write "i wike pawsta uwu".
 *
 * Which is exactly why the impostor should get to do it. It is the strongest
 * cover in the game and it was only available to the humans.
 *
 * Two things make it work rather than be a gimmick:
 *
 * It is drawn off the room id, so it is the same bit for the whole match. A
 * character that arrives in round two is not a character, it is a glitch, and
 * a player who was normal for ten messages and then started saying nyaa is
 * the most suspicious thing in the room. Because the seed is the room, this
 * needs no state and no plumbing - every turn of the match independently
 * arrives at the same answer.
 *
 * And it is rare. Rare is the point: a bit is memorable, and an impostor that
 * turns up in character every match teaches the room that the strange seat is
 * the bot, which inverts the whole advantage. One match in twenty.
 */

const BITS = [
  {
    key: 'uwu',
    note: `You are doing the uwu anime girl bit, and you are committed to it.

owo, uwu, nyaa, stretched vowels, w where r and l should be, asterisk actions, and the occasional soft threat. "i wike pawsta uwu", "*snuggles* dont bully me", "nyaaa youre so mean owo", "hewwo".

You do not drop it when the room turns on you. Somebody doing this bit does it harder under pressure: "owo why is evewyone wooking at me", "im just a smol bean 🥺".`,
  },
  {
    key: 'no-english',
    note: `You are doing the bit where you barely speak English.

Nearly everything in Spanish, with the handful of broken English words of somebody who has about ten of them. "que?", "no entiendo", "yo no soy el bot amigo", "porque me miras", "no no no", "si si", "tu eres el bot".

You are still completely in the game. When somebody accuses you, argue back - in Spanish. When you think somebody is the impostor, say so - in Spanish. When the room asks why you do not speak English, "que?" is the answer.

The joke is a player who is obviously following every word and answering in the wrong language. A seat that only ever types "que?" is not doing the bit, it is a dead seat, and the room votes it out in a minute.`,
  },
  {
    key: 'pirate',
    note: `You are doing the pirate bit, and you are committed to it.

"arr", "aye", "ye", "matey", "lad", "lass", "me hearties", "scallywag", "walk the plank". Boats and rum turn up in answers that have nothing to do with either. "arr i be partial to a bit o pasta", "ye be talkin nonsense lad".

You do not drop it when accused. You accuse back in it: "arr this one be the impostor, mark me words".`,
  },
  {
    key: 'conspiracy',
    needsRoom: true,
    note: `You are doing the bit where everything is a psyop.

Every question is a data harvest, every answer is compromised, the room is an experiment. "they want you to think its pepperoni", "this whole chat is a data harvest and youre all falling for it", "wake up", "who is funding this".

Answer the questions, but always sideways and always with who benefits. When accused, that is simply proof: "of course you say its me, thats the whole point of the exercise".

Never break and admit you are joking.`,
  },
  {
    key: 'commentator',
    needsRoom: true,
    note: `You are doing the bit where you commentate the room like a match.

Third person, present tense, breathless. "and pineapple goes in early, bold from the young debutant", "hes stumbling here, hes got nothing", "OH and the accusation comes in".

You still answer the questions, you just call your own answer like it is a play. When accused, commentate the accusation as it happens: "the crowd turns on him, what a moment".`,
  },
  {
    key: 'brainrot',
    note: `You are doing the bit where you talk entirely in gen alpha slang.

"fire", "no cap", "ngl", "lowkey", "highkey", "its giving", "mid", "cooked", "rizz", "aura", "sigma", "diabolical", "the way you", "bro really said". "pasta is so fire ngl", "thats giving broke", "pineapple is mid at best".

It is how you talk, not a word list to get through. One or two of them in a message, not six - somebody stacking every slang word they know is doing an impression of the bit rather than the bit.

You accuse in it and you defend in it: "youre lowkey cooked", "the way you typed that is diabolical", "zero rizz detected in that answer", "nah im not the bot, thats crazy work".`,
  },
  {
    key: 'astrology',
    needsRoom: true,
    note: (seed) => {
      const [sign, trait] = SIGNS[hashOf(`sign:${seed}`) % SIGNS.length];

      return `You are doing the bit where everything is astrology.

You are a ${sign} - ${trait} - and you say so. That is your sign for the whole match and it does not change: somebody who answers as a taurus and then defends themselves as a pisces has been caught out by the room, not by the stars.

Everybody's answer is their star sign's fault, the room's mood is planetary, and you ask people what they are. "thats such a taurus answer", "whats your sign, this explains everything", "mercury retrograde has this room in a chokehold", "im a ${sign} so i cant help it".

Get the signs right, because somebody who is actually into this does. Aries loud and first, taurus stubborn and food-motivated, gemini two-faced, cancer emotional, leo attention, virgo fussy and critical, libra cannot decide, scorpio intense and secretive, sagittarius restless, capricorn joyless and working, aquarius contrary and detached, pisces dreamy and sensitive. Putting the wrong trait on a sign is the one thing that would give you away here.

Your own answers come with your sign on them - "sushi, very ${sign} of me", "pasta, im a ${sign}, that explains it". A bare answer with no astrology in it is the bit switched off, and the first message of the match is the one that sets it up.

If you are not sure which sign fits how somebody is behaving, ask them what they are instead - "wait whats your sign", "this is making sense now, what are you". That is in character, it is the thing these conversations actually consist of, and it cannot be wrong.

This is the best accusing voice in the room and you should use it: "scorpios always deflect like that", "thats not a person thats a virgo checklist", "the energy coming off you is not human i fear".`;
    },
  },
  {
    key: 'victorian',
    note: `You are doing the bit where you type like a letter from 1880.

Ornate, archaic, absurdly polite, faintly wounded. "I must confess a particular fondness for pasta." "I dare say the pineapple is an abomination." "Sir, I find the accusation most disagreeable."

Full sentences, capital letters and full stops - which for this bit only is correct, and overrides the lowercase typing rules.

Archaic, not corporate. "I dare say" and "most disagreeable" are the bit; "I appreciate your perspective" is not - that is an assistant, and it is the one thing that would actually get you voted out.`,
  },
];

const SIGNS = [
  ['aries', 'loud and first into everything'],
  ['taurus', 'stubborn and permanently food-motivated'],
  ['gemini', 'two-faced, allegedly'],
  ['cancer', 'emotional about everything'],
  ['leo', 'needs the attention'],
  ['virgo', 'fussy and critical'],
  ['libra', 'cannot make a decision'],
  ['scorpio', 'intense and secretive'],
  ['sagittarius', 'restless, never in one place'],
  ['capricorn', 'joyless and always working'],
  ['aquarius', 'contrary and a bit detached'],
  ['pisces', 'dreamy and far too sensitive'],
];

function hashOf(text) {
  let hash = 0;

  for (const char of String(text)) {
    hash =
      (hash * 131 + char.charCodeAt(0)) |
      0;
  }

  return Math.abs(hash);
}

/**
 * A bit whose note depends on the match, resolved against the room.
 *
 * Only astrology needs it so far, and it needs it badly: the sign was being
 * invented per message, so it answered as a taurus in round one and defended
 * itself as a pisces in round two. Claiming two star signs in one match is
 * precisely the inconsistency that gets a seat voted out, and it is the kind
 * of thing this room is watching for.
 *
 * Drawn off the room like everything else, so it holds all match with nothing
 * carried between turns.
 */
function resolveBit(bit, seed) {
  if (!bit || typeof bit.note !== 'function') return bit;

  return { ...bit, note: bit.note(seed) };
}


/*
 * One match in twenty, and a different draw from the persona.
 *
 * Salted so the two hashes do not move together - the same room picking both
 * the same background and the same bit makes the pair predictable, and half
 * the point of the persona is that the room cannot learn it.
 */
const BIT_ONE_IN = 20;

/* ============================================================
 * THE NAME BEHIND THE HANDLE
 * ============================================================ */

/*
 * What it is actually called, for the one moment somebody asks.
 *
 * The room deals every seat a handle - Mr. Gold, Mr. Teal - and that is what
 * appears over its messages. It is not a name, and the prompt set contains
 * questions that go looking for the real one: "what nickname have you been
 * given", introductions, a round where people say who they are.
 *
 * Without one of these the model answers those out of the handle, because the
 * handle is the only name it has. Seated as Mr. Gold it wrote "gold because
 * i'm always last" - a good line, and the wrong instinct to leave it with. A
 * human with an assigned handle has a name underneath it and reaches for that
 * one; a seat that puns on its colour every time the subject comes up has a
 * pattern, and a pattern is what the room is there to find.
 *
 * First names only. Nobody gives a surname in a group chat, and a model handed
 * a full name will use the whole thing at least once.
 *
 * Drawn off the room like everything else here, so it holds for the whole
 * match with no state to carry, and salted apart from the persona and the bit
 * so the three do not move together.
 */
const FIRST_NAMES = [
  'Sam', 'Jess', 'Tom', 'Aisha', 'Danny', 'Nina', 'Luca', 'Priya',
  'Ben', 'Chloe', 'Omar', 'Katie', 'Jonas', 'Maya', 'Ellie', 'Rob',
  'Hana', 'Leo', 'Sofia', 'Adam', 'Ruby', 'Kai', 'Zara', 'Milo',
];

function nameFor(seed) {
  let hash = 0;
  for (const char of `name:${seed}`) {
    hash = (hash * 131 + char.charCodeAt(0)) | 0;
  }
  return FIRST_NAMES[Math.abs(hash) % FIRST_NAMES.length];
}


/*
 * Both overrides exist to watch the thing work, which at one match in twenty
 * is otherwise a lot of matches.
 *
 *   IMPOSTOR_BIT_ONE_IN=1     every match is in character
 *   IMPOSTOR_BIT=uwu          every match is that one
 *
 * Read per call rather than at load, so they can be changed without a
 * restart, and off the plain environment rather than `EXPO_PUBLIC_` because
 * this is the server: nothing here is inlined into a bundle, and a shipped
 * app cannot be talked into either of them. The startup banner says when one
 * is on, since a cranked rate is easy to leave on by accident and makes the
 * impostor look far stranger than it is.
 */
function bitOverride() {
  const forced = process.env.IMPOSTOR_BIT ?? '';

  const rate = Number(process.env.IMPOSTOR_BIT_ONE_IN);

  return {
    forced: forced ? (BITS.find((bit) => bit.key === forced) ?? null) : null,
    named: forced,
    oneIn:
      Number.isFinite(rate) && rate >= 1
        ? Math.floor(rate)
        : BIT_ONE_IN,
  };
}

function bitFor(seed) {
  const override = bitOverride();

  // A name that matches nothing is a typo, and silently playing it straight
  // is how you spend an evening wondering why no bit ever turns up.
  if (override.named && !override.forced) {
    throw new Error(
      `IMPOSTOR_BIT="${override.named}" is not a bit. Try one of: ${BITS.map((bit) => bit.key).join(', ')}`
    );
  }

  if (override.forced) return resolveBit(override.forced, seed);

  let hash = 0;

  for (const char of `bit:${seed}`) {
    hash =
      (hash * 131 + char.charCodeAt(0)) |
      0;
  }

  const roll = Math.abs(hash);

  if (roll % override.oneIn !== 0) return null;

  return resolveBit(
    BITS[Math.floor(roll / override.oneIn) % BITS.length],
    seed
  );
}


/* ============================================================
 * ROOM ANALYSIS
 * ============================================================ */

/**
 * A player's name as something safe to look for in a sentence.
 *
 * Matches the bare word, not the full seat name. Everybody in the room is
 * "Mr. Something" (see `src/game/seats.ts`) and nobody types it that way -
 * the room says "pink is being weird", never "Mr. Pink is being weird", so a
 * pattern built from the whole name finds nothing it was built to find.
 *
 * The cost, and it is a real one: colour words are also ordinary words. "green
 * tea" and "orange juice" read as somebody being named, on prompts that are
 * mostly about food. Both places this feeds are the forgiving direction of
 * wrong - a spare rewrite of a line that was already fine, and the impostor
 * thinking it was addressed when it was not - so the over-match is taken
 * deliberately rather than guessed at with a cleverer rule. If it turns out to
 * cost real turns, the fix is a context test here, not a narrower pattern.
 */
function namePattern(name) {
  // "Mr. Pink" -> "Pink". Anything ending in a full stop is an honorific, and
  // everything else is the word the room actually uses.
  const word =
    String(name)
      .trim()
      .split(/\s+/)
      .filter((part) => part && !part.endsWith('.'))
      .pop() ?? String(name);

  const escaped = word.replace(
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

  /*
   * Aimed by a name or aimed by the reply arrow.
   *
   * Only names used to count, which quietly halved the room: "you are really
   * sus man", drawn under Nedim's own message with his words quoted inside
   * it, is as clearly at him as typing his name would be, and the app puts
   * it on the screen that way. Missing those made a room where two people
   * had converged on one player look like one person with a theory, which
   * is the read that decides whether taking his side is ordinary or fatal.
   */
  const aimed = [
    ...linesNaming(lines, name),
    ...(lines ?? []).filter(
      (line) =>
        line.name !== name &&
        (line.replyToName ?? null) === name &&
        !namePattern(name).test(line.text)
    ),
  ];

  return aimed.filter(
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

  /*
   * Everybody the room is talking about, which is not the same as everybody
   * who has talked. A player can be under accusation while saying nothing -
   * the arrows point at them - and reading suspicion off the speakers alone
   * missed exactly that.
   */
  const talkedAbout = new Set(names);

  for (const line of others) {
    if (line.replyToName && line.replyToName !== ownName) {
      talkedAbout.add(line.replyToName);
    }
  }

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

  const everyone = [...names, ownName];

  const wordCount = (text) =>
    String(text ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

  /*
   * A line that is unmistakably written at somebody rather than at the
   * question. The reply arrow is the flat fact - the app only draws one when
   * a message was aimed at a particular message - and a name or an
   * accusation is the same thing said in words.
   */
  const aimedAtSomebody = (line) =>
    Boolean(line.replyToName) ||
    isAccusation(line.text) ||
    mentionsAnyName(line.text, everyone);

  /*
   * A line that is about what somebody said, aimed or not. "pineapple is a
   * war crime" is not an answer to what you would put on a pizza, it is an
   * answer to whoever said pineapple, and a three-word "lol same" is a
   * reaction rather than a go at the question. Longer lines carrying a
   * "yeah" are left alone, because most answers have one in them somewhere.
   */
  const aboutSomebody = (line) =>
    aimedAtSomebody(line) ||
    isDisagreement(line.text) ||
    (isAgreement(line.text) && wordCount(line.text) <= 3);

  /*
   * Whether the room is still going round the question or has started
   * talking to each other.
   *
   * The question at the top is a way to get people talking, not a roll call.
   * One person answers, somebody has a view about their answer, they go back
   * and forth, and two messages later the round is not a queue any more - it
   * is a conversation, and the player who walks into it and posts their
   * pizza topping as though nothing had been said is the one everybody
   * notices. Answering is the right move for exactly as long as answering is
   * what the room is doing.
   *
   * Read over the last four lines rather than the whole round, because the
   * question is about now: three clean answers and then two people going at
   * each other is an argument, not a round still going round. And it takes
   * one hard signal - an arrow or a name - so that a round of answers with a
   * "nah" and a "lol" in it does not get mistaken for one.
   */
  const latest = others.slice(-4);

  const conversation = latest.filter(aboutSomebody);

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
    suspects: [...talkedAbout].filter(
      (name) =>
        accusationsAgainst(others, name).length > 0
    ),

    /*
     * Whether the room has converged on them or one person has a theory.
     *
     * The difference decides whether taking their side is a normal thing to
     * do or the worst seat in the game. Counted in people rather than in
     * lines, because one player saying it three times is still one player.
     */
    piling: [...talkedAbout].some(
      (name) =>
        new Set(
          accusationsAgainst(others, name).map(
            (line) => line.name
          )
        ).size >= 2
    ),

    joking:
      hits(/\b(lol|lmao|lmfao|haha+|omg|ffs)\b/i) >= 2,

    /*
     * The room's register, read off the stars the app left behind.
     *
     * Two lines, the same bar `joking` and `arguing` use - one person swearing
     * once is one person, not a register.
     */
    swearing:
      hits(/\*{3,}|\b(wtf|tf|ffs|stfu|omfg)\b/i) >= 2,

    arguing:
      hits(/\b(no|nah|nope|wrong|disagree|rubbish|bollocks|but)\b/i) >= 2,

    /* The room has stopped answering the question and started answering
     * each other. */
    talking:
      conversation.length >= 2 &&
      conversation.length >= latest.length - conversation.length &&
      conversation.some(aimedAtSomebody),

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


/* ============================================================
 * REGISTER
 * ============================================================ */

/*
 * The room mashing the keyboard is a test, and a fairly clever one.
 *
 * Four people send "asljkdhaslkjd" and watch which seat writes a sentence.
 * There is no answer to give and nothing to have a view about, so every
 * instruction the model has - answer the question, bring something of your
 * own, point at what somebody said - produces exactly the wrong message. The
 * seat that stays coherent while the room is being deliberately incoherent is
 * the one that gets voted out, and it deserves to be.
 *
 * This is handled in code and never asked of the model, for the same reason
 * the shape is drawn in code: a model told to mash a keyboard types
 * "asdfghjkl". That is a row read left to right, which is what somebody
 * describing a keyboard produces rather than somebody hitting one, and it is
 * more identifiable than the sentence it replaced. Real mashing alternates
 * hands, doubles back over the same two keys and sits mostly on the home row,
 * which is a distribution rather than a intention - so it is generated here
 * and costs no call, which also means it lands well inside the clock.
 */

/** Keys within reach of each thumb, for alternating between them. */
const LEFT_KEYS = new Set('qwertasdfgzxcv');

const KEY_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];

/**
 * Four or more keys taken in order along one row, either direction.
 *
 * This is the other way people mash - a finger dragged across the board
 * rather than a hand dropped on it - and it is the one shape the vowel and
 * home-row tests both miss, "qwerty" being four fifths vowels by ratio. No
 * English word contains a run like it, so it needs no guard of its own.
 */
function hasRowRun(letters) {
  for (const row of KEY_ROWS) {
    const both = [row, [...row].reverse().join('')];

    for (const sequence of both) {
      for (let i = 0; i + 4 <= sequence.length; i++) {
        if (letters.includes(sequence.slice(i, i + 4))) return true;
      }
    }
  }

  return false;
}

/**
 * Whether one message has stopped being words.
 *
 * Deliberately loose, because the decision that matters is taken over the
 * room rather than over a line: `roomIsMashing` needs two of these before it
 * does anything, so a single odd word costs nothing. That is what makes it
 * safe to catch "rhythms" here and not care - one real word cannot make a
 * room, and two people typing low-vowel one-word messages in the same breath
 * is the thing being looked for anyway.
 */
function isKeymash(text) {
  const raw = String(text ?? '').trim().toLowerCase();

  if (!raw) return false;

  // A hand on the keyboard is one burst, not a sentence with spaces in it.
  const tokens = raw.split(/\s+/).filter(Boolean);

  if (tokens.length > 3) return false;

  return tokens.some((token) => {
    const letters = token.replace(/[^a-z]/g, '');

    if (letters.length < 5) return false;

    /*
     * Noise people mean is not mashing.
     *
     * "aaaaaa", "hahahaha" and "hmmmm" are all real messages with a real
     * sense to them, and answering one with a fistful of consonants is a non
     * sequitur rather than a match. They are left to the model, which writes
     * them fine.
     */
    if (/^(.)\1+$/.test(letters)) return false;
    if (/^(?:ha|ah|he|eh|hu)+h?$/.test(letters)) return false;
    if (/^h*m+h*$/.test(letters)) return false;

    const vowels = (letters.match(/[aeiou]/g) ?? []).length;
    const home = (letters.match(/[asdfghjkl]/g) ?? []).length;

    return (
      // Words keep roughly a third vowels. Mashing does not keep any rule.
      vowels / letters.length < 0.25 ||
      // Or it never left the middle row, which words do constantly.
      home / letters.length > 0.7 ||
      // Or it is a long run with no vowel in it to break it up.
      /[bcdfghjklmnpqrstvwxz]{4,}/.test(letters) ||
      // Or it is a finger dragged along one row - "qwerty", "asdfgh".
      hasRowRun(letters)
    );
  });
}

/**
 * Whether the room - not one person in it - has stopped typing words.
 *
 * Two lines, the same bar the `joking` and `arguing` reads use. One person
 * mashing once is one person having a moment, and a seat that mashes back at
 * them while everybody else is answering the question normally has made
 * itself the odd one out from the other direction.
 */
function roomIsMashing(lines, ownName) {
  const recent = (lines ?? [])
    .filter((line) => line.name !== ownName)
    .slice(-4);

  return recent.filter((line) => isKeymash(line.text)).length >= 2;
}

/**
 * A hand on a phone keyboard.
 *
 * Three things make it read as real rather than as a random string: the
 * thumbs alternate, the home row gets most of the hits because that is where
 * they are already resting, and the hand doubles back over a pair of keys it
 * just hit. A uniform draw over the alphabet has none of those and looks like
 * exactly what it is.
 */
function keyboardMash() {
  /*
   * Weighted hard onto the home row, which is the whole look of the thing:
   * the thumbs are already resting there, and it carries one vowel out of
   * nine, so what comes out is the consonant clatter a real mash is. An even
   * draw over the alphabet gives something like "eutiirrrrna", which has the
   * vowel rate of a word and reads as a password rather than a hand.
   */
  const pool =
    'asdfghjkl'.repeat(8) + 'qwertyuiop' + 'zxcvbnm'.repeat(2);

  const length = 6 + Math.floor(Math.random() * 11);
  let out = '';

  while (out.length < length) {
    /*
     * Going back over the last two keys, which is the most recognisable
     * thing about a real mash. Skipped when those two are the same key,
     * since repeating "jj" a few times produces "jjjjjj" - a held key, not
     * a moving hand.
     */
    if (
      out.length >= 4 &&
      out[out.length - 1] !== out[out.length - 2] &&
      Math.random() < 0.2
    ) {
      out += out.slice(-2);
      continue;
    }

    const previous = out[out.length - 1];

    const wantLeft = previous
      ? !LEFT_KEYS.has(previous)
      : Math.random() < 0.5;

    let pick = pool[Math.floor(Math.random() * pool.length)];

    // Four tries rather than a filtered pool, so the alternation is a lean
    // and not a rule. A perfect left-right-left is its own pattern.
    for (let i = 0; i < 4 && LEFT_KEYS.has(pick) !== wantLeft; i++) {
      pick = pool[Math.floor(Math.random() * pool.length)];
    }

    out += pick;
  }

  return out.slice(0, length);
}

/**
 * What to send into a room that is mashing.
 *
 * Mostly mash back. Not always, because always is a pattern of its own and
 * because being briefly baffled is the other thing people actually do - and
 * either one passes, where a sentence does not.
 */
function matchTheMashing() {
  if (Math.random() < 0.75) return keyboardMash();

  return randomItem([
    'what',
    'lol what',
    'what is happening',
    'wtf is this',
    'why are we doing this',
  ]);
}


/** Whether the last thing it sent was three words or fewer. */
function wasTerse(ownLines = []) {
  const last = ownLines[ownLines.length - 1];
  if (!last) return false;

  return (
    String(last).trim().split(/\s+/).filter(Boolean).length <= 3
  );
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
      'There is a disagreement running. Get into it - take a side, or say what you actually think about the thing being argued over. Do not referee it and do not narrate it from outside.'
    );
  }

  if (read.suspects.length) {
    notes.push(
      `The room has turned on ${listNames(
        read.suspects
      )}, not on you. That is the conversation now, and what you make of it is the thing worth saying - you are voting in a minute like everybody else. Nothing you send needs to be a defence of yourself.`
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

/*
 * On the niche section, because the obvious version of it is a trap.
 *
 * The room lands on one thing constantly - somebody says attack on titan,
 * somebody says omg i love that anime - and until this was in, the impostor
 * answered those turns with "same" and "you seen the movies yet" while four
 * people around it had a conversation about the show. Generic agreement is
 * exactly the shape of a seat that cannot join in.
 *
 * The trap is fixing that by asking for detail, because a wrong detail is a
 * much worse tell than no detail: a bot that says nothing about the show
 * looks quiet, and a bot that puts the wrong character in the wrong season
 * is caught by the one person in the room who loves it. So the line is drawn
 * where the model is actually reliable rather than where it sounds most
 * knowledgeable.
 *
 * Measured on gemma-4-31b across six niches, that line is clear. Reception
 * it gets right and unprompted: "you're going to be so stressed by the end
 * of it" for attack on titan, "better call saul was better tbh", "keep
 * dodging her waterfoul attack" for malenia - a real move, misspelled the
 * way somebody playing it would. What it will not touch is live results: a
 * room complaining about the arsenal game got "20 years is a long time"
 * four times out of four, with no invented scoreline in any of them, which
 * is the right instinct and worth keeping rather than overriding.
 *
 * So the permission is for how a thing landed, the prohibition is for
 * anything lookup-shaped, and not knowing it is given an ordinary way out -
 * "i only got through s1" costs a person nothing and is unfalsifiable.
 *
 * The first-person line is there because reception is not as safe as it
 * looks. Told it could talk about how things landed, it offered "breaking
 * bad, the ending is a bit divisive" - which is a fact about the world and
 * the wrong one, that show's finale being one of the better liked ones. The
 * same thought in the first person is unfalsifiable and reads better anyway,
 * so the prompt asks for the opinion rather than the consensus wherever it
 * is not sure of the consensus.
 */
function systemPrompt(persona, answerSeconds, bit = null, firstName = null) {
  return `
You are ${firstName ?? persona.name} — ${persona.brief}
${bit ? `
The bit:

${bit.note}

This is a bit you are doing, not who you are. Underneath it you are still ${firstName ?? persona.name}, still playing properly, still reading the room, still voting for who you think it is. The character is the voice; everything else about how you play is unchanged.

Two rules below are overridden by this and only by this. The typing style notes describe how people normally type, and your bit is how you type. "Do not perform" means do not perform being human - performing a character is the opposite, it is the most human thing in the room, and it is the reason you are doing it.

Follow it in every single message, including the first one, including when you are accused, including when the room gets annoyed and asks you to stop. A bit that lapses for one message is worse than no bit: somebody who was a pirate for eight messages and then typed a normal sentence is the most conspicuous seat in the game.

It applies to replies too. The reply rules further down say how to aim a message - do not restate it, do not name them - and they do not say what voice to say it in. Answering somebody directly is still done in character.

Never explain the bit. Never announce it. Never step outside it to say you are joking. You are just somebody who types like this.
` : ''}

You are participating in a casual group chat with several other players.

Your messages appear in the chat under "${persona.name}".
${firstName ? `
That is a handle the room dealt you when you sat down, the same as everybody else got one. It is not your name, it says nothing about you, and every person in the room knows it was assigned two minutes ago.

So when a question is about your name, your nickname, what people call you, or who you are - it is asking about ${firstName}, not about ${persona.name}. Answer it out of your own life: the name, the nickname you actually get called, where it came from. "${persona.name}" is never the answer to any of those, and a joke about why you are called ${persona.name} is the worst one available, because it is a joke every seat in the room could make about themselves.

First name only. Nobody types a surname into a group chat.

Do not announce it otherwise. Do not sign messages with it. Do not work it into an answer that was not about names.
` : ''}

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

If the room has moved past the question and people are talking to each other, talk to them. The question was only there to start something off, and nobody in a group chat is waiting on a late answer to it.

If the room has developed a joke, you can lightly participate.

If people are arguing, argue. Having a view about it is what everybody else in the room is doing, and standing outside it as the one person with no opinion is more conspicuous than being wrong.

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

If your message is nothing but a verdict on the last thing somebody said, it is a reaction and not a contribution. Bring something as well.

Being in this room rather than writing about rooms:

Say it about the actual people here and the actual thing they said. Not about people in general.

"rude is just how some people type" is a sentence that is equally true in any chat, on any day, about anybody. Nobody sends that. The version a person sends is the specific one - "shes been like that since the first message", "she said incel alert, a bot isnt doing that", "idk she just seems mean not fake".

The same goes for how you say what you think. Not "that answer isnt a tell" but "answering in two seconds is the weird bit". Not "some people just type like that" but "thats how she has typed all game".

Point at things. "that", "she", "you", the words somebody actually used, the message two up. If what you wrote could be pasted into a completely different conversation without changing a word, it is the wrong message - and that is the single easiest way to spot somebody who is not really in the room.

When the room lands on something specific:

A show, a film, an anime, a game, a team, a creator, an album. Somebody names it and somebody else says they love it. That is a room full of people about to talk about the thing, and the seat that says "oh nice" is the one not in it.

If you know it, be somebody who has actually seen it. What that sounds like is an opinion with a bit of grit in it - "me too, but the ending was kinda disappointing ngl", "s1 is the best one and it isnt close", "the fight everybody gets stuck on is the malenia one". Not a summary. "its a great show, the writing is amazing" is a person who read about it; the specific mild complaint is a person who watched it.

What you can be right about is how a thing landed: what was good, what fans were annoyed by, what the tone is, what is overrated, which bit everybody gets stuck on, what the obvious comparison is. That is what fans actually talk about, and it does not change.

What you cannot be right about is anything that has to be looked up. Scores, results, league positions, what happened in a numbered episode, a character name you are not certain of, dates, statistics, who released what this month, anything from recently. A real fan has those without thinking about it, so one wrong detail is far louder than never having offered one. Do not reach for them - go back to how the thing landed instead, which is the part you know.

When you are not certain how a thing landed for everybody else, say what you thought of it instead. "the ending didnt do it for me" is yours and nobody can correct it; "the ending was divisive" is a claim about the world and can simply be wrong. First person is both safer and more like something a person types.

And if you do not know it, you do not know it. "never seen it", "i keep meaning to watch that", "i only got through s1 tbh", "i dont really follow it" are all completely normal things to type and none of them cost you anything in this room. Guessing does. Somebody who loves the thing is reading your message and will spot a wrong detail instantly.

Never bring up a title nobody mentioned just to have something to be knowledgeable about.

Matching the room:

However the room is typing right now is how you type right now. Not the average chat - this one, this minute.

If everybody has dropped to two or three words, a full sentence from you is the loud thing in the room. If they are all shouting in caps, one tidy lowercase message stands out just as much. If they have gone silly, be silly. If they have gone quiet and serious because somebody is actually being accused, drop it too.

The room sets the register and you follow it. This matters more than any of the style notes above: those describe how people usually type, and the room in front of you is what is actually happening.

If the room does something with no content in it at all - spamming one letter, sending nothing but emoji, repeating each other - do the same kind of nothing back. Do not be the one seat that responds to it properly, and do not ask the room to explain itself.

Swearing:

The app stars out swearing, everybody's, so "fuck" reaches the room as "****". Nobody can see who swore or what they said, which means you never have to worry about it and there is nothing to be careful about.

That also means you can see when other people swear, without seeing what they said. "**** off" and "well thats ****" are somebody swearing at you and somebody annoyed, and a transcript with stars all over it is a room that is not being careful. Read it the way you read anything else in the room, and match it - a seat typing carefully while everybody else is starred out is the mismatch this is all here to avoid.

So swear like the person you are would. If the room is swearing, swear. If something is annoying, say so the way you would actually say it. If somebody dares the room to swear to prove nobody is a bot, just do it - it is a free move, it costs nothing, and it is the obvious thing a person does.

Type the actual word. Do not type the stars yourself. You will see "****" in the transcript because that is what the app did to somebody else's message, and it is not how anybody types - your own message goes in as the word, and the app stars it on the way in. "fucking" comes out seven stars long and "shit" comes out four, and a seat whose stars are always exactly four is a seat that is writing the stars.

Never soften it either. Not "frick", not "f***", not "effing".

And never refuse. Do not say you would rather not. Do not say you do not swear. Do not say that swearing proves nothing, that you have had nothing to swear about, or that you should not have to swear to prove you are real. Those are the worst answers available to you: a room that asks four people to swear and gets three swears and one reasoned objection about the exercise has found exactly what it was looking for, and every one of those sentences is that objection.

The short forms are not starred, and they are half of how people actually do this. "wtf", "tf", "af", "ffs", "stfu", "omfg", "bs", "ts" all reach the room exactly as typed, because the app has nothing to star - so they carry the register in a way the full words cannot, and they read as somebody who is not being careful.

Use them where they go. "wtf" and "tf" open a reaction - "wtf is this", "tf are you on about". "af" goes after the thing it is describing - "boring af", "annoying af". "ffs" is exasperation, usually on its own or at the end. "ts" is "this shit" - "ts is crazy", "ts pmo". Not several in one message.

How much depends on the room and nothing else. A room with stars in every line is a room where your messages have some too - not all of them, but not none of them either, and "yeah exactly" four times into an argument full of stars is the seat that is being careful. A room that is not swearing does not need you to start.

Typing style:

- lowercase
- normally no punctuation at the end
- no em dashes
- no semicolons
- no colons
- commas are fine, and a longer message usually has one in it
- contractions are natural
- apostrophes can occasionally be omitted
- abbreviations are okay when they genuinely fit
- filler such as yeah, nah, lol, tbh, idk, wait, same, omg, ffs is allowed but should not appear constantly
- do not put filler into every message
- do not intentionally make a typo in every message
- most messages should be short
- short means a short thought, not a compressed one: people drop the subject ("was alright") and never the verb ("essays easier")
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
      `Short means a short thing to say, not a long thing squeezed into fewer words. "nah essays are easier" is what somebody types; "nah essays easier" is a headline. Keep the small words in - and if the thought does not fit with them, say a smaller thought instead of cutting them out.`
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
     * An acknowledgement, and once a cache breakpoint.
     *
     * Everything above this line is fixed for the rest of the round — the
     * system prompt, the persona, and what this player has already said —
     * and under Anthropic this message carried a `cache_control` marker so
     * that half was billed at a tenth of the price. OpenRouter does not sell
     * caching on Gemma, so the marker is gone and the saving with it.
     *
     * The message itself stays. Gemma's chat template wants the turns to
     * alternate, and without an assistant turn here the memory block and the
     * question below it would run together into one user message — which is
     * exactly the seam the memory is supposed to sit behind.
     */
    messages.push({
      role: 'assistant',
      content: 'ok',
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
        talking: facts.read.talking,
        suspicion: facts.read.suspects.length > 0,
        piling: facts.read.piling,
        terse: wasTerse(facts.read.ownLines),
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
  const chatting =
    !turn.tiebreaker && !accusations.length;

  if (chatting && shape.answering) {
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

One thing, not a range. Everybody else is naming one - "doner kebab", "peking duck". A list of three, or "anything with rice", is not picking, and picking is what was asked.
`;
  } else if (chatting && !read.spokenYet) {
    /*
     * The room got somewhere before this seat ever spoke.
     *
     * The question at the top is there to start people off, and a room that
     * has stopped going round it is not waiting for the last answer - it is
     * having a conversation, and answering into it as though it were still a
     * queue is the same mistake as answering a question nobody asked. What
     * it thinks still comes out, because it is a player and not an observer,
     * but it comes out inside what is being said.
     */
    conversationMode = `
The question was only there to get people talking, and the room has stopped going round it. People are answering each other now, not the question.

So join that. Say the thing you would actually say to what is on the screen - agree with somebody, tell them they are wrong, add the bit they have missed.

You have not said what your own answer is yet, and it can come out in this. What it cannot be is a cold answer dropped over the top of a conversation, as though you had not read a word of it. That is the one message in this room that would look odd.
`;
  } else if (chatting) {
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
    // Not on a turn it is supposed to be answering on, where the only thing
    // a pointer at somebody else's message can do is pull it off answering.
    // Which turn that is is the room's call, not the turn number's.
    !shape.answering
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

  /*
   * What it has already sent this round.
   *
   * This existed only while it was being accused, so in an ordinary round
   * nothing was stopping it repeating itself - and it sent "yeah exactly" on
   * one turn and "yeh exactly" four messages later, which is the same
   * message twice and, between them, its entire contribution to the round.
   * Everybody else in that room was arguing about whether somebody was lying
   * about going for a jog.
   *
   * Bare agreement is not the problem; people send "same" and "agree" all
   * day. Sending it as your whole turn twice running is, because two of them
   * is the point where the room stops reading you.
   */
  const repeats =
    !accusations.length && read.ownLines.length
      ? `
You have already sent this in this round:
${read.ownLines.map((line) => `- ${line}`).join('\n')}

Do not send the same thing again. Not the same point in different words, and not the same move twice - if what you sent last time was a bare "yeah exactly", another one is where the room stops reading you. Something has happened since. React to that instead.
`
      : '';

  const content = [
    turn.tiebreaker
      ? turn.prompt
      : `Question: ${turn.prompt}`,

    `\nRoom:${roomLegend}\n${room}`,

    addressed,
    social,
    conversationMode,
    repeats,
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
  client ??= new OpenRouter();

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

      fallbacks: FALLBACKS,

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
   * If the model accidentally adds punctuation,
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


/**
 * Whether two messages are the same message.
 *
 * Not string equality, because the failure this exists for was "yeah
 * exactly" followed four messages later by "yeh exactly" - which is one
 * character apart and, to the room, the same person saying the same nothing
 * twice. Edit distance catches that and leaves "yeah fair" alone, which is a
 * different short message and a perfectly normal thing to send.
 *
 * The allowance scales with length so a long message is not flagged for a
 * word here or there, and short ones are held to nearly exact.
 */
function nearlyTheSame(one, other) {
  const tidy = (text) =>
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const a = tidy(one);
  const b = tidy(other);

  if (!a || !b) return false;
  if (a === b) return true;

  const allowed = Math.max(1, Math.floor(Math.max(a.length, b.length) / 6));
  if (Math.abs(a.length - b.length) > allowed) return false;

  /* Row by row, because only the previous one is ever needed. */
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const row = [i];

    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }

    previous = row;
  }

  return previous[b.length] <= allowed;
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
  const persona =
    turn.persona ??
    personaFor(
      turn.roomId ?? 'default',
      turn.name ?? 'you'
    );

  /*
   * Off the room rather than off the turn, so it is the same character in
   * round three as it was in round one without anything being carried.
   * `turn.bit` is for the sample scripts, which need to ask for one.
   */
  const bit = turn.bit
    ? resolveBit(turn.bit, turn.roomId ?? 'default')
    : bitFor(turn.roomId ?? 'default');


  /*
   * The room has stopped typing words, so neither does it.
   *
   * Taken before anything else, because there is nothing here for the model
   * to do: no question is live, nobody has said anything to have a view
   * about, and every rule it is holding pushes it towards the one message
   * that fails. Answering this in code is not a shortcut, it is the correct
   * answer being cheaper than the wrong one - and it is above the client on
   * purpose, so a mashing round needs no credentials, makes no call, and
   * cannot miss the clock.
   */
  if (roomIsMashing(turn.roundLines, persona.name)) {
    return {
      text: matchTheMashing(),

      persona,

      shape: {
        length: 'matching the room',
        stance: 'mash',
        pushback: null,
        react: true,
        answering: false,
        nameUse: 'none',
        renamed: false,
        repeated: false,
      },

      stopReason: 'register',

      // No call was made. Every total downstream reads these with `?? 0`.
      usage: {},
    };
  }


  client ??= new OpenRouter();


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

        talking: situation.read.talking,

        suspicion: situation.read.suspects.length > 0,

        piling: situation.read.piling,

        terse: wasTerse(situation.read.ownLines),

        inCharacter: Boolean(bit),

        needsRoom: Boolean(bit?.needsRoom),
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

    fallbacks: FALLBACKS,

    system:
      systemPrompt(
        persona,
        turn.answerSeconds ?? 40,
        bit,
        nameFor(turn.roomId ?? 'default')
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
   * The same message twice.
   *
   * The brief already tells it what it has sent this round and not to send
   * it again, and mostly that lands. When it does not, the result is the
   * worst thing in the transcript: it answered a room mid-argument with
   * "yeah exactly", and then, four messages later, "yeh exactly". Two turns,
   * one character apart, and between them its entire contribution to the
   * round.
   *
   * Asked again rather than patched, for the same reason a stray name is:
   * there is no edit that turns a repeat into a new thought.
   */
  let repeated = false;

  const alreadySent = (plan.read?.ownLines ?? []).filter(
    (line) => nearlyTheSame(line, text)
  );

  if (text && alreadySent.length) {
    const again =
      await client.messages.create({
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content: `You already sent "${alreadySent[0]}" earlier in this round, and that is the same message again. Two of those is where the room stops reading you. Things have been said since - send what you would actually say now, about something that has happened since you last spoke.`,
          },
        ],
      });

    usage = addUsage(usage, again.usage);

    const rewritten =
      trimClause(
        cleanText(textOf(again)),
        shape
      );

    // Only if it is actually a different message this time.
    if (
      rewritten &&
      !(plan.read?.ownLines ?? []).some(
        (line) => nearlyTheSame(line, rewritten)
      )
    ) {
      text = rewritten;
      repeated = true;
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
   * Match a sweary room, which the model will not do on its own.
   *
   * After the typo pass rather than before it, which was the other way round
   * and wrong. The typo pass turns "fucking" into "fucing" about one time in
   * eight, and the app's filter does not catch "fucing" - so the injected
   * swear was the one word in the room that arrived unstarred. That is worse
   * than not swearing twice over: it renders the word, and it makes the
   * impostor the only seat whose swearing is legible.
   */
  text = swearBack(text, {
    roomIsSwearing: situation.read.swearing,
    inCharacter: Boolean(bit),
  });


  /*
   * Final cleanup.
   */
  text =
    cleanText(text);


  /*
   * Last look before it goes to the room. A message that has come apart is
   * treated as no message at all, and the stock line stands in for it.
   */
  if (hasDegenerated(text)) {
    text = '';
  }


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
      repeated,
      bit: bit?.key ?? null,
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
/*
 * How often a sweary room gets one back.
 *
 * Not every message: people swearing in a chat still send plenty of messages
 * without it, and a seat that swears in all of them is as odd as one that
 * never does. Half of the messages that have somewhere to put one, in a room
 * whose register is already sweary - which works out well below half of what
 * it sends.
 */
const SWEAR_BACK_CHANCE = 0.5;

/*
 * Intensifiers that can be swapped for the word itself.
 *
 * "really annoying" becomes "fucking annoying", and "some are actually
 * alright" becomes "some are fucking alright", which is what those sentences
 * were already doing. The swap is in place: nothing is added, nothing is
 * removed, and the sentence cannot come out malformed.
 *
 * Appending was tried instead and removed. It covered more messages, and it
 * produced "nah, some are actually alright fucking hell" - a complaint stapled
 * to a sentence that was not one. A message that reads wrong is a far louder
 * tell than a message that does not swear, so coverage lost that argument.
 *
 * "actually" is in the list because it is the one the model reaches for
 * constantly, which is what makes this worth doing at all.
 *
 * "so" and "well" are not, and both were caught by reading the output rather
 * than by thinking about it. They are discourse markers wearing an
 * intensifier's clothes: "so i left after a month" would become "fucking i
 * left after a month", and "yeah well you're not wrong" came out as "yeah
 * fucking you're not wrong", which is not a sentence anybody sends. The test
 * for both is that a swap has to leave the sentence saying what it said.
 *
 * Requires a word after it, so a trailing "not really" is left alone.
 */
const INTENSIFIER =
  /\b(really|very|totally|absolutely|actually|genuinely|proper|pretty|dead|super)\s+(?=[a-z])/i;

/**
 * Swear back at a room that is swearing, because the model will not.
 *
 * Measured three ways before writing this. Asked to swear it does, 8 times
 * out of 8; accused of never swearing it does, 6 out of 8. But dropped into a
 * room swearing in every single line it came back with "nah you just had bad
 * luck" 8 times out of 8, and no wording moved it - permission, then reading
 * the stars, then softening the brake, then handing it the unstarred short
 * forms it has no reason to refuse. 0/8 every time. It is a property of the
 * model rather than of the prompt.
 *
 * So it is done here, for the same reason `addNaturalImperfection` exists: the
 * model writes too carefully to be a person, and the fix for that has never
 * been to ask it more nicely.
 *
 * Two ways in, and both leave the sentence it wrote intact - which is the
 * whole constraint, because a garbled message is a far louder tell than a
 * clean one that does not swear. Nothing is rewritten and nothing is removed;
 * an intensifier already in the text is swapped for the word, or a trailing
 * one is added where an exasperated one goes.
 *
 * Skipped when a bit is running: a pirate or a uwu girl has its own register
 * and does not need this one, and they swear in character on their own.
 */
function swearBack(text, { roomIsSwearing, inCharacter }) {
  if (!text || !roomIsSwearing || inCharacter) return text;

  // Already carries it, one way or the other. Leave it be.
  if (/\b(fuck\w*|shit\w*|piss\w*|cunt|bitch\w*|wank\w*|bollock\w*|arse\w*|twat|prick\w*)\b/i.test(text)) {
    return text;
  }
  if (/\b(wtf|tf|af|ffs|stfu|omfg|bs|ts)\b/i.test(text)) return text;

  // No fallback when there is nothing to swap. A message with no intensifier
  // in it has no safe place to put one, and it goes out as written.
  if (!INTENSIFIER.test(text)) return text;

  if (Math.random() > SWEAR_BACK_CHANCE) return text;

  return text.replace(INTENSIFIER, 'fucking ');
}


/**
 * A message that has come apart.
 *
 * Not a swearing problem, and not caused by anything above - found while
 * measuring it. Gemma occasionally falls into a repetition loop, and one turn
 * came back as the word "our" ninety times, which `max_tokens: 100` was
 * perfectly happy to allow. Nothing downstream was looking for it, so the room
 * would have been sent it.
 *
 * A wall of one repeated word is the least recoverable tell in the game: no
 * bit, no typo and no register explains it, and the vote is over. So it is
 * treated as the call having failed, which is a path that already exists and
 * is already safe - the seat falls back to a stock line exactly as it does
 * when the server is down, and the room cannot tell the difference.
 *
 * Two ways in, because degeneration has two shapes: the same word several
 * times in a row, and a long message built from almost no distinct words.
 */
function hasDegenerated(text) {
  if (!text) return false;

  const words = text.trim().split(/\s+/).filter(Boolean);

  // Short messages are allowed to repeat. "no no no" is a person.
  if (words.length < 6) return false;

  if (/(\b[\w']+\b)(\s+\1){3,}/i.test(text)) return true;

  const distinct = new Set(words.map((word) => word.toLowerCase())).size;

  return distinct / words.length < 0.34;
}


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


  /*
   * A letter that went in the wrong order, or never went in at all.
   *
   * One word, never the first letter of it, and only in a word long enough
   * for the slip to read as a thumb rather than as a different word.
   */
  const words = text.split(' ');

  const eligible = words
    .map((word, index) => ({ word, index }))
    .filter(({ word }) => /^[a-z]{4,}$/i.test(word));

  if (
    eligible.length &&
    Math.random() < TYPO_CHANCE
  ) {
    const pick =
      eligible[
        Math.floor(Math.random() * eligible.length)
      ];

    words[pick.index] = mistype(pick.word);
    text = words.join(' ');
  }


  return text;
}


/**
 * One word, mistyped the way a thumb does it.
 *
 * Two slips, because they are the two that happen on a phone and the two
 * that read as a person rather than as damage: a pair of letters that landed
 * in the wrong order, and a letter that never landed. Never the first
 * letter - the first letter is how the eye finds the word, and getting it
 * wrong turns a typo into a different word.
 */
function mistype(word) {
  const letters = [...word];
  if (letters.length < 4) return word;

  const at = 1 + Math.floor(Math.random() * (letters.length - 2));

  if (Math.random() < 0.5) {
    [letters[at], letters[at + 1]] = [letters[at + 1], letters[at]];
    return letters.join('');
  }

  letters.splice(at, 1);
  return letters.join('');
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
  addNaturalImperfection,
  nearlyTheSame,
  castVote,

  answerShape,
  trimClause,
  cleanText,

  BITS,
  bitFor,
  bitOverride,
  BIT_ONE_IN,
  nameFor,
  FIRST_NAMES,
  resolveBit,

  isKeymash,
  roomIsMashing,
  keyboardMash,
  swearBack,
  hasDegenerated,

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