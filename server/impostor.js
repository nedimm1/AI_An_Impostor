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

/**
 * How long this seat's messages run, for the whole match.
 *
 * The length of any one message was already a draw, but it was drawn from the
 * same table every time, so every match came out at the same average: a seat
 * that mostly sends eight to thirteen words, every round, in every room. Real
 * people are not distributed like that. One of them answers everything in two
 * words all evening and another writes a paragraph about a kebab, and the
 * thing that gives a seat away is not the length of a message, it is the
 * length of all of them together.
 *
 * So the table itself is drawn once per match, off the room id, the same way
 * the persona and the bit are. `bias` multiplies the weight of each band in
 * `LENGTHS`, in order.
 */
const REGISTERS = [
  {
    weight: 30,
    key: 'clipped',
    /* Two to five words, nearly always. Answers, not messages. */
    bias: [2.2, 1.4, 0.5, 0.15, 0.05],
  },
  {
    weight: 45,
    key: 'ordinary',
    bias: [1, 1, 1, 1, 1],
  },
  {
    weight: 25,
    key: 'talkative',
    /* Says the whole thought, and occasionally more of it than anybody wanted. */
    bias: [0.4, 0.8, 1.4, 1.6, 1.5],
  },
];

/*
 * Deliberately lower than the old implementation.
 *
 * If nearly half the messages contain a typo/apostrophe trick,
 * the pattern itself becomes suspicious.
 *
 * This is the population rate, not a seat's rate. Which one a seat gets is
 * `TYPISTS` below.
 */
const IMPERFECTION_CHANCE = 0.3;

/*
 * How much of a mess this particular person makes of typing, for the match.
 *
 * The rate was one number for every seat in every room, which is the same
 * mistake `REGISTERS` was written to fix one line down from here: a draw that
 * is right about the population and wrong about everybody in it. A seat
 * mistyping almost exactly three messages in ten, match after match, is a
 * distribution rather than a person, and it is the kind of thing this room is
 * counting.
 *
 * Real rooms are nothing like that. One round had four seats typing
 * "sicence", "typ", "dosent" and "icebregg" while other people go a whole
 * match without a slip - not because they are careful, but because they are
 * on a keyboard, or they reread things, or they just do not. So the rate is
 * drawn once off the room id and holds all match, and the weights are set so
 * the room still averages `IMPERFECTION_CHANCE` across seats.
 *
 * Length and spelling are drawn separately on purpose. Someone who answers in
 * three words is not thereby someone who misspells them, and pairing the two
 * would build four kinds of person instead of nine.
 */
const TYPISTS = [
  {
    weight: 30,
    key: 'clean',
    /* Reads it back before sending, or just does not miss. */
    rate: 0.05,
  },
  {
    weight: 45,
    key: 'ordinary',
    rate: 0.3,
  },
  {
    weight: 25,
    key: 'messy',
    /* Thumbs, moving, not looking. Sends it anyway. */
    rate: 0.6,
  },
];

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
 *
 * Off. Drawn on chat turns, every one it produced in the replays read as a
 * seat free-associating at the room: "apple, orange, maybe a grape" after it
 * had already said cereal, "whale liver, seal blubber, raw squid", "what car,
 * ford, honda, bmw". Nobody in the logged matches types a list at anybody.
 */
const LIST_CHANCE = 0;

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
 * How often it puts its own answer up anyway, into a room that has got
 * talking.
 *
 * Mostly it should join what is being said rather than post an answer over
 * the top of it. Not always, though: people do drop their own answer into a
 * room mid-argument, either because they only just read the question or
 * because the argument is not theirs, and a seat that never once does it is
 * a seat that always does the correct thing.
 */
const ANSWER_OVER_TALK_CHANCE = 0.2;

/**
 * How few lines from other people make a room too thin to agree with.
 *
 * Two, because that is the smallest room that can be having a conversation
 * at all: one answer and one line aimed at it.
 */
const SHALLOW_ROOM = 2;


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
  /*
   * Not having one.
   *
   * Everybody else in the room gets asked forty-three questions over a match
   * and does not have a view about all of them; the seat that produces a
   * considered answer to every single one is the seat that is being asked to.
   * "idk" is a whole message and a very common one, and it is the one thing
   * a model will never do unless it is told it is allowed to.
   */
  {
    weight: 8,
    key: 'pass',
    note: 'You have not got one of these, and you are not going to invent one. Say so the way it is true for this question - "never had one", "i dont do karaoke", "cant cook at all lol" - and that is the whole message. Not having one, not being unable to pick: "i can never choose" is dodging, and everybody can tell. Do not apologise for it and do not give an answer anyway after it.',
  },
];

/*
 * The questions somebody can honestly not have an answer to.
 *
 * rm_lb23g: asked for its favourite food, it drew `pass` and sent "idk
 * honestly, i can never actually pick one when people ask this stuff". Every
 * person alive has a favourite food, and fourteen words of not picking is
 * a seat stalling. Most of the list is like that - the last thing you ate,
 * what is on your home screen - so passing is kept to the handful where not
 * having one is ordinary: no nickname, no party trick, no karaoke song.
 */
const PASSABLE =
  /\b(nickname|useless talent|karaoke|cook well|will not touch|board game|card game)\b/i;

function canPass(prompt) {
  return PASSABLE.test(String(prompt ?? ''));
}

/*
 * Questions whose answers are opinions, and so can be disagreed with.
 *
 * Under "My first car, thanks dad" - the best gift Cyan had been given - it
 * drew `disagree` seven times in sixteen and sent "nah cars are too much
 * work". Somebody's favourite food is fair game. The last thing they ate,
 * what is in their pockets, what their dad gave them - those are things that
 * happened to them, and "nah" to one of those is not a take, it is not having
 * understood the question. So it is an allowlist: taste and opinion only.
 *
 * Only the answers are covered. A room that starts its own argument - the
 * home-screen round that became cats against dogs - is arguable whatever the
 * prompt was, and `arguing` in the room read lets it back in.
 */
const ARGUABLE =
  /\b(favou?rite|go-to|defend|will not touch|never get bored|coffee shop order|snack|best film|watching at the moment|annoys you|makes your day better|would you go tomorrow)\b/i;

function canArgue(prompt) {
  return ARGUABLE.test(String(prompt ?? ''));
}

/*
 * The same turn, into a screen that is not empty.
 *
 * Everybody is still answering, so an answer is still what this turn is - but
 * it is the second or third one, and the ones above it were read before this
 * one was typed. A person answering into a thread answers through what is
 * already in it: they say theirs is the same, or they put theirs next to the
 * one above. The plain version - the answer standing on its own as though the
 * screen were empty - is the one that reads as a form being filled in, and it
 * was sending that one every single time, because the note told it to.
 *
 * "me too" is a whole answer here, and it is the most ordinary message in a
 * group chat. That was the half with no way to happen at all: agreeing is not
 * on the table while its own answer is outstanding, so a room where somebody
 * had already said the obvious thing got a seat solemnly saying it again.
 */
const STANCE_OWN_ALONGSIDE = {
  weight: 88,
  key: 'own',
  note: 'Answer the question. If somebody has already said yours, that is your answer - "me too lol", "same". If yours is different, just say yours. Not a verdict on their answer and then yours: "pizza is classic, burgers for me" is two messages in one, and people answer or react, not both at once.',
};

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
/*
 * The room has asked its own question and this seat has not answered it.
 * See `roomQuestionFor`: three turns of reacting to Pink's answer and never
 * giving one is what got it voted out in rm_rx7qk.
 */
const STANCE_OWN_ROOM = {
  weight: 1,
  key: 'own',
  note: 'Answer the question the room is on with your own answer - one real, specific thing of yours, the way everybody else gave theirs. A reaction to somebody else\'s answer ("bold choice", "nah", "real ones know") is not an answer, and neither is going along with theirs. You can react to theirs as well, but yours has to be in the message.',
};

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

/*
 * Going after somebody, rather than weighing in on whoever else is.
 *
 * Asked for its attitude to be more aggressive and its reasons better. Until
 * now it only ever reacted to a name somebody else had put up, and when it did
 * the reason was "too quiet" or "acting sus" - the reason anybody could give
 * about anybody, which is the reason that reads as having none. The target and
 * what they have actually said come with the turn (`pushTarget`); this is the
 * attitude.
 */
const STANCE_PUSH = {
  weight: 55,
  key: 'push',
  note: 'You think it is them and you want them out this vote. Say it with a reason that is theirs - a few of their own words, or the vote they cast - and say that you are voting them, the way a person says it about themselves: "im voting X", "i think imma vote X", "X is getting my vote", "yeah im going X this round". Not an order to the room - "vote X" on its own is a command, and people talk about their own vote. Sure of it: no "maybe", no asking the room what it thinks first. Blunt and a bit heated is fine; a speech is not.',
};

/*
 * Having nothing to add, and saying so - or talking about something else.
 *
 * rm_cia0cbk: having said "idk dont follow marvel", it had no honest way into
 * a Toby-versus-Holland argument, and the stances on offer all asked it to
 * have a view. People in that spot do one of two things: they say, lightly,
 * that they have got nothing here, or they bring up something of their own.
 *
 * The examples are shuffled on every draw. One example is copied word for
 * word (it happened with "what car was it"); a different first one each time
 * is not.
 */
const SIDESTEP_EXAMPLES = [
  '"rly wish i could add something here lol"',
  '"got nothing for this one tbh"',
  '"ill leave yall to it lol"',
  '"this is way over my head"',
  '"cant help yall with this one"',
];

function sidestepNote() {
  const examples = [...SIDESTEP_EXAMPLES]
    .sort(() => Math.random() - 0.5)
    .slice(0, 3)
    .join(', ');

  return `Nothing you could honestly say fits what the room is on, so do not force a take. Either say, lightly, that you have got nothing here - ${examples}, in your own words - or bring up something else: your own answer to the question, or a thing next to it that you actually know. Not an apology and not an explanation; one easy line.`;
}

const STANCE_SIDESTEP = { weight: 5, key: 'sidestep' };

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
    note: 'You agree. Say so straight out - "yeah exactly", "same", "agree", "fax", "this is the correct answer" - and say why if the message has room for it. One word on its own is a real message and half a chat is made of them. No hedging and no qualifying it to death.',
  },
  {
    weight: 21,
    key: 'disagree',
    /*
     * Two things it must not do, and they are different failures.
     *
     * Never a claim about them: what somebody has tried, owned or been through
     * is not something this seat knows, and inventing it is the tell that
     * `inventsAboutThem` catches after the fact.
     *
     * Never against itself: "disagree" is a brief about somebody else's answer,
     * and a model handed it while the room is against the thing it said will
     * take the room's side and argue against its own claim - see
     * `ownLinesThisRound`. Disagreeing with the room is a move; disagreeing
     * with your own answer is a player who forgot they had one.
     */
    note: 'You disagree, and that is fine. Say it plainly - you think they are wrong about this, and here is what you think instead. Your reason is yours: what you like, what you have done, how it went for you. Never a claim about them - what they have tried, owned or been through is not something you know, and "you just havent had a good one" is you making it up. Have a go at the opinion, never at the person: no insults, nothing personal, nothing that turns the room. Somebody being wrong about pizza is not a thing to get worked up about. Never disagree with something you yourself have already said in this room - if the room is against your answer, you are the one defending it, not joining in against it.',
  },
];

/*
 * Being the one who changes the subject.
 *
 * It can follow one now - somebody types "forget the question, what did yall
 * think of the new spiderman movie" and the room goes with them - but it will
 * never be the seat that sends it, and over a match that is its own shape:
 * five players, four of whom wander off at some point, and one who answers
 * whatever is on the screen every single turn. The most reliably on-topic
 * person in the room is not the most human one in it.
 *
 * Small, and hedged in `stanceTable` rather than here, because the move is
 * only ordinary in a room with nothing going on. Dropped into an argument it
 * is somebody not listening, and dropped into a round where a name is up it
 * is somebody with a reason to move the conversation - which is the single
 * most suspicious thing a seat can do in this game.
 *
 * What it must not be is a topic chosen to be knowledgeable about. The system
 * prompt already bans dropping a title nobody mentioned, and this is the one
 * stance that could quietly walk around that, so it says so again.
 */
const STANCE_REDIRECT = {
  weight: 5,
  key: 'redirect',
  note: 'Change the subject. Ask the room something of your own - an ordinary question you would actually type into a group chat, off the back of nothing. "wait has anyone else not slept", "random but whats everyone doing this weekend". Not a title, not a film, not a thing you could be knowledgeable about: something everybody in the room can answer. Do not answer the question at the top as well, and do not explain why you are changing the subject.',
};


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
  answered = false,
  challenged = false,
  argument = false,
  replying = false,
  unanswered = false,
  suspicion = false,
  piling = false,
  shallow = false,
  backed = false,
  joke = false,
  passable = false,
  roomOwed = false,
  arguable = true,
  hunting = false,
  outOfIt = false,
  afterVote = false,
} = {}) {
  /*
   * Answering into a room that has answers in it is still answering, and the
   * only thing that changes is whether the answer is allowed to land on one
   * of them. `answered` is the flat fact that there is something on the
   * screen - on the turn this fires, the seat has not spoken yet, so
   * everything up there belongs to somebody else.
   */
  if (answering) {
    const options = STANCES_ANSWERING.filter(
      (option) => passable || option.key !== 'pass'
    );
    return answered
      ? options.map((option) =>
          option.key === 'own' ? STANCE_OWN_ALONGSIDE : option
        )
      : options;
  }

  // Being accused still gets its defence; everything else waits for this.
  if (roomOwed && !challenged) {
    return [STANCE_OWN_ROOM];
  }

  let pool = [...STANCES_TALKING];

  /*
   * Two lines in, there is not enough on the screen to be agreeing with.
   *
   * An exchange now starts on one aimed line - somebody says Egypt, somebody
   * writes "overrated imo" under it - which is right, but it means the turn
   * can come round while the room is three lines old, and a fifth of those
   * draws came out as "same" or "yeah same" and nothing else. Agreement is a
   * real move and most of a chat is made of it, but it is a move that needs
   * something to land on: as the whole of the first thing you say into a
   * conversation that has barely started, it is a seat taking up a turn to
   * say nothing, and it is the message a room forgets it ever read.
   */
  if (shallow) {
    pool = pool.map((option) =>
      option.key === 'agree'
        ? { ...option, weight: Math.round(option.weight * 0.3) }
        : option
    );
  }

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

  /*
   * Somebody has just taken its side. Disagreeing there is disagreeing with
   * its own answer and with the one person backing it (see `backedBy`).
   */
  if (backed || !arguable) {
    pool = pool.filter((option) => option.key !== 'disagree');
  }


  /*
   * A joke is running (see `jokeInPlay`). Disagreeing with a wind-up is
   * correcting it - "no one actually eats that" - and a tangent walks out of
   * it: "reminds me of a weird documentary", under "whale liver? lol".
   */
  if (joke) {
    pool = pool.filter(
      (option) => option.key !== 'disagree' && option.key !== 'tangent'
    );
  }

  /*
   * Only into a room with nothing going on.
   *
   * Not mid-argument, not while somebody is being replied to, not while its
   * own answer is still outstanding, and above all not while a name is in the
   * frame: changing the subject with somebody under accusation is the move of
   * a player who wants the subject changed.
   */
  if (
    !argument &&
    !challenged &&
    !replying &&
    !suspicion &&
    !unanswered &&
    !shallow &&
    !joke
  ) {
    pool.push(STANCE_REDIRECT);
  }

  /*
   * The room is on who it is. Mostly it goes after somebody itself; the rest
   * of the time it is weighing in on whoever the room already has (`pile`,
   * `doubt`, above). Not while it is the one being accused - that turn is a
   * defence - and not into a joke.
   *
   * And now and then without being asked, once there is enough of a round to
   * have a read on people: picking a target early is what a player who wants
   * to win does, and it was the one thing it never did.
   */
  if (!challenged && !joke) {
    if (hunting || suspicion) {
      pool.push(STANCE_PUSH);
    } else if (!shallow && !backed && afterVote && !argument) {
      // Only once there has been a vote to argue from. In round one of
      // rm_cia0cbk, in the middle of a film argument: "voting mr. silver,
      // pretty good sus" - a target with nothing behind it.
      pool.push({ ...STANCE_PUSH, weight: 8 });
    }
  }

  /*
   * Out of it (it said it does not follow the thing): sidestepping is the
   * main move, and changing the subject is allowed even mid-argument - the
   * argument is about something it has no part in. Otherwise now and then,
   * on an ordinary turn, as the honest alternative to a forced take.
   */
  if (outOfIt && !challenged) {
    pool.push({ ...STANCE_SIDESTEP, weight: 45, note: sidestepNote() });
    if (!pool.some((option) => option.key === 'redirect')) {
      pool.push({ ...STANCE_REDIRECT, weight: 12 });
    }
  } else if (!challenged && !suspicion && !hunting) {
    pool.push({ ...STANCE_SIDESTEP, note: sidestepNote() });
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
  //
  // And it said it does not follow the thing, so it has no side in it
  // (`saidNotFollowing`). Last, because `back` is added above.
  return pool.filter(
    (option) =>
      !(replying && option.key === 'own') &&
      !(outOfIt && ['agree', 'disagree', 'back'].includes(option.key))
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


/**
 * The same draw as `weighted`, decided by a seed rather than by a roll.
 *
 * For the things that have to hold still for a whole match: a register that
 * changed every turn would be nobody at all.
 */
function weightedBy(hash, options) {
  const total = options.reduce((sum, option) => sum + option.weight, 0);

  let n = hash % total;

  for (const option of options) {
    n -= option.weight;
    if (n < 0) return option;
  }

  return options[options.length - 1];
}


/** This match's register, off the room id. Same room, same seat, all match. */
function registerFor(seed) {
  return weightedBy(hashOf(`register:${seed}`), REGISTERS);
}


/** And how badly it types, drawn the same way and just as fixed. */
function typistFor(seed) {
  return weightedBy(hashOf(`typist:${seed}`), TYPISTS);
}

/*
 * Autocorrect's capitals.
 *
 * Everything it sent was lowercased (`cleanText`), and across the logged
 * matches 93% of the people's lines started with a capital and none of its
 * did - phones capitalise the first letter and "i" on their own, and the one
 * seat that never has a capital letter is the one not typing on a phone.
 *
 * Only what the keyboard does, not what a careful writer does: the first
 * letter, the first letter after a full stop, question mark or exclamation
 * mark, and "I". Names stay as typed - autocorrect does not know them either.
 * Drawn once per match, like the rest of how it types: most people leave it
 * on, and the ones who turn it off type in lowercase all evening.
 */
const AUTOCAPS_SHARE = 90;

function autocapsFor(seed) {
  return hashOf(`caps:${seed}`) % 100 < AUTOCAPS_SHARE;
}

function phoneCaps(text) {
  if (!text) return text;

  return text
    .replace(/\bi(?=$|[\s,.!?]|['’](m|ve|ll|d)\b)/g, 'I')
    .replace(/(^|[.!?]\s+)([a-z])/g, (whole, before, letter) => before + letter.toUpperCase());
}


/* ============================================================
 * WHAT THIS SEAT DOES NOT FOLLOW
 * ============================================================ */

/*
 * Nobody has seen everything, and the seat that has is the bot.
 *
 * The room lands on one thing constantly, and the prompt already covers the
 * half where it knows the thing: how it landed, never a fact that can be
 * looked up. What it had no way to do is the other answer, which is the one
 * most of a real room gives. Five people get asked about the ending of attack
 * on titan and two of them have not seen it. "idk didnt watch it" is a whole
 * message and the most common one there is.
 *
 * It will not get there on its own. A model handed a title it knows always
 * has something to say about it, so having nothing to say has to be drawn
 * rather than hoped for - and drawn off the room id, because a seat that does
 * not watch anime at the top of the match does not watch it at the bottom
 * either. A coin flip per turn would have it dodging a show in one message
 * and reviewing it in the next, which is a worse tell than either answer.
 *
 * Two layers, because the two sentences are different. A genre it does not
 * follow at all, standing for the whole match, which is "idk i dont really
 * watch anime" and holds for every title in that genre. And, inside a genre
 * it does follow, whether it has seen this particular thing - its own draw,
 * per thing per match, because you can watch anime and still not have got
 * round to most of it.
 *
 * The patterns are the conservative half of each niche. A word that is also
 * an ordinary word - saw, city, scream, cod - is left out entirely: matching
 * one of those turns a question about lunch into "idk never watched it",
 * which is far stranger than any of this is worth.
 */
const NICHES = [
  {
    key: 'anime',
    label: 'anime',
    out: 'idk i dont really watch anime',
    test: /\b(anime|manga|shonen|shounen|aot|attack on titan|one piece|naruto|jujutsu kaisen|demon slayer|death note|dragon ball|ghibli|chainsaw man|solo leveling|my hero academia|fullmetal alchemist)\b/i,
  },
  {
    key: 'superhero',
    label: 'marvel and superhero films',
    out: 'idk i dont really do marvel films',
    test: /\b(marvel|mcu|dceu|avengers|spider[- ]?man|spiderman|batman|superman|deadpool|x-men|iron man|captain america|the boys|justice league)\b/i,
  },
  {
    key: 'horror',
    label: 'horror',
    out: 'idk i dont watch horror',
    test: /\b(horror|slasher|jump ?scares?|the conjuring|insidious|hereditary|the exorcist|terrifier|paranormal activity|midsommar|the shining)\b/i,
  },
  {
    key: 'football',
    label: 'football',
    out: 'idk i dont follow football',
    test: /\b(football|soccer|premier league|champions league|arsenal|chelsea|liverpool|man utd|man united|tottenham|real madrid|barcelona|messi|ronaldo|haaland|offside|transfer window)\b/i,
  },
  {
    key: 'games',
    label: 'games',
    out: 'idk i dont really play games',
    test: /\b(elden ring|dark souls|fortnite|valorant|league of legends|minecraft|gta|call of duty|zelda|pokemon|baldurs gate|speedrun|playstation|xbox|nintendo|steam sale)\b/i,
  },
  {
    key: 'reality',
    label: 'reality tv',
    out: 'idk i dont watch reality tv',
    test: /\b(love island|big brother|the bachelor|kardashians|real housewives|married at first sight|reality tv|selling sunset|too hot to handle)\b/i,
  },
  {
    key: 'kpop',
    label: 'kpop',
    out: 'idk im not really into kpop',
    test: /\b(kpop|k-pop|bts|blackpink|stray kids|newjeans|twice|seventeen|kdrama|k-drama)\b/i,
  },
];

/** How many of them this seat does not follow at all. */
const BLIND_SPOTS = 2;

/**
 * How often it has not seen a particular thing inside a genre it does follow.
 *
 * High, because the alternative is a seat that has seen everything anybody
 * names. Between this and the two genres it does not touch, a room that lands
 * on something specific gets "never watched it" about seven times in ten -
 * which is a normal group chat, where most of the room is being told about
 * the thing rather than discussing it.
 */
const UNSEEN_CHANCE = 50;

/** The two genres this seat does not follow, all match. */
function blindSpotsFor(seed) {
  const pool = [...NICHES];
  const picked = [];

  while (picked.length < BLIND_SPOTS && pool.length) {
    const hash = hashOf(`niche:${seed}:${picked.length}`);
    picked.push(pool.splice(hash % pool.length, 1)[0]);
  }

  return picked;
}

/** The niche a line is about, if it is about one. */
function nicheIn(text) {
  return (
    NICHES.find((niche) => niche.test.test(String(text ?? ''))) ??
    null
  );
}

/**
 * Whether this is a turn it has to sit out, and what it says when it does.
 *
 * Read off the last few lines from other people, most recent first, and it
 * stops at the first niche it finds: that is what the room is on, and whether
 * it happens to know the next thing down the transcript is not the question.
 * A niche it does follow and has seen returns null, which is the turn the
 * rest of the prompt was already written for.
 */
function unseenFor(seed, lines, ownName) {
  const recent = recentLines(lines)
    .slice(-4)
    .filter((line) => line.name !== ownName)
    .reverse();

  for (const line of recent) {
    const niche = nicheIn(line.text);

    if (!niche) continue;

    if (blindSpotsFor(seed).some((spot) => spot.key === niche.key)) {
      return { ...niche, kind: 'genre' };
    }

    return hashOf(`seen:${seed}:${niche.key}`) % 100 < UNSEEN_CHANCE
      ? { ...niche, kind: 'thing', out: 'idk i never watched it' }
      : null;
  }

  return null;
}


/*
 * What it said it does not follow, earlier this round.
 *
 * `unseenFor` reads the last four lines for the niche, which is right for the
 * turn it fires on and forgets it straight after. rm_cia0cbk: "idk dont follow
 * marvel" under a Spider-Man line - then three lines of "tom holland is the
 * best", "its toby", none of which say Marvel, and it sent "yeah exactly, toby
 * is the only one that actually feels like a movie". Two people walked out on
 * the next line.
 */
const NOT_FOLLOWING =
  /\b(dont|don'?t|do not|never|havent|haven'?t|not really)\b[^.?!]*\b(follow|watch|watched|seen|play|played|into)\b|\bnever (watched|seen|played)\b/i;

function saidNotFollowing(lines, ownName) {
  const mine = (lines ?? []).filter((line) => line.name === ownName);
  for (let i = mine.length - 1; i >= 0; i--) {
    if (NOT_FOLLOWING.test(mine[i].text)) return mine[i].text;
  }
  return null;
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
/*
 * How long the room is actually typing: the median word count of everybody
 * else's recent lines, or null while there is too little to go on.
 *
 * The register above is a person, and it holds all match - but it was the
 * only thing deciding length, so in a room of "W dad", "Fr" and "Very
 * poetic" it could still draw fourteen to twenty words, and did (rm_c7wm3l6).
 * People talk at the length of the room they are in.
 */
function roomWordsFor(lines, ownName) {
  const counts = (lines ?? [])
    .filter((line) => line.name !== ownName)
    .slice(-8)
    .map((line) => String(line.text).trim().split(/\s+/).filter(Boolean).length)
    .filter((count) => count > 0)
    .sort((a, b) => a - b);

  if (counts.length < 2) return null;

  return counts[Math.floor(counts.length / 2)];
}

/*
 * Bands well past the room's length become rare, not impossible - the odd
 * long message is real; a seat that is always the longest line is not.
 */
function matchRoom(bands, roomWords) {
  if (!roomWords) return bands;

  return bands.map((band) => {
    const pull =
      band.min > roomWords * 2.5 ? 0.03 : band.min > roomWords * 1.5 ? 0.4 : 1;
    return { ...band, weight: band.weight * pull };
  });
}


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
    elsewhere = false,
    suspicion = false,
    piling = false,
    shallow = false,
    terse = false,
    inCharacter = false,
    needsRoom = false,
    register = null,
    typist = null,
    unseen = null,
    backed = false,
    joke = false,
    passable = false,
    roomOwed = false,
    roomWords = null,
    arguable = true,
    hunting = false,
    outOfIt = false,
    afterVote = false,
    allied = false,
  } = {}
) {
  let bands = [...LENGTHS];

  /*
   * This match's register, applied before everything else so that the rules
   * below - a bit needs room, a defence needs room, not two one-word turns
   * running - still get the last word on any particular turn.
   */
  if (register) {
    bands = bands.map((band, i) => ({
      ...band,
      weight: Math.max(0, Math.round(band.weight * (register.bias[i] ?? 1))),
    }));
  }

  // Then the room. Before the floors below, so a defence or a bit still gets
  // the room it needs whatever everybody else is typing.
  bands = matchRoom(bands, roomWords);


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
   * Owing the room an answer while replying to somebody. Three words is room
   * for the reply or the answer, and it picks the reply: under "do you also
   * like goth girls" it sent a bare "nah" five times in ten.
   */
  if (roomOwed && replying) {
    bands = raiseFloor(bands, 3);
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

  /*
   * A room still on the question and a room that has left it are not the
   * same thing, and only one of them leaves room to answer anyway.
   *
   * `talking` is people arguing about the answers - the question is still
   * what the room is about, so putting yours up over the top of it is a
   * clumsy move rather than an impossible one, and people do it.
   *
   * `elsewhere` is a conversation that is not the question at all: the vote,
   * a name, something one of them asked. Whatever that is, it started while
   * this seat was sitting there, and there is no version of answering the
   * prompt into it that reads as a person. So that one takes the turn.
   */
  const busy = talking || elsewhere;

  const answering =
    owesAnswer &&
    !elsewhere &&
    (!talking || Math.random() < ANSWER_OVER_TALK_CHANCE);

  /*
   * The room is on something this seat does not follow, or has not got round
   * to. That decides the turn on its own - there is no stance to draw,
   * because having a view is the one thing it has just said it cannot do,
   * and a draw that came out "disagree" here would have it arguing about a
   * show it has not seen.
   *
   * Not while it is being accused. Being asked why you voted somebody out is
   * not a turn you get to sit out because somebody mentioned an anime two
   * lines up, and the accusation brief owns that message anyway.
   */
  const sittingOut = Boolean(
    unseen && !underPressure && !tiebreaker
  );

  const stance = sittingOut
    ? {
        key: 'unseen',
        note: `You have not seen the thing the room is on${
          unseen.kind === 'genre'
            ? `, because you do not really follow ${unseen.label}`
            : ''
        }. Say so and stop: "${unseen.out}" is the whole message. Do not have an opinion about it anyway, do not ask them to explain it to you, and do not apologise for not having seen it - nobody in this room cares, and it is not a thing anybody follows up.`,
      }
    : underPressure || tiebreaker
      ? null
      : weighted(
          stanceTable({
            answering: answering || !hasRoom,
            answered: hasRoom,
            challenged,
            argument,
            replying,
            unanswered: owesAnswer && busy,
            suspicion,
            piling,
            shallow,
            backed,
            joke,
            passable,
            roomOwed,
            arguable,
            hunting,
            outOfIt,
            afterVote,
          })
        );

  /*
   * How hard it pushes back, when it is being pushed.
   */
  // With somebody else already on the accuser, the counter is the move.
  const pushback = underPressure
    ? allied && !onTrial && !tiebreaker
      ? weighted([
          { weight: 85, key: 'counter' },
          { weight: 15, key: 'annoyed' },
        ]).key
      : weighted(
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
    !sittingOut &&
    Math.random() < LIST_CHANCE;

  // A push is a reason and then a vote, and the comma between them is the
  // message: without it "the wtf was weird, im voting orange" went out as
  // "just the wtf", ten times in ten (`trimClause`).
  const clause =
    stance?.key === 'push' ||
    (!list &&
      !underPressure &&
      !tiebreaker &&
      !sittingOut &&
      Math.random() < clauseChanceFor(length));

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
    stance?.key !== 'redirect' &&
    Math.random() < REACTION_CHANCE;

  /*
   * A redirect is a question by construction - it is somebody asking the room
   * something of their own - so it does not also get drawn for one.
   */
  const askQuestion =
    stance?.key === 'redirect' ||
    (hasRoom &&
      !underPressure &&
      !tiebreaker &&
      !sittingOut &&
      Math.random() < QUESTION_CHANCE);

  const sloppy =
    Math.random() < (typist?.rate ?? IMPERFECTION_CHANCE);

  /*
   * "idk didnt watch it" is four words, and the band it was drawn into could
   * have asked for thirty. A seat told to say nothing in a paragraph writes
   * the paragraph.
   */
  // Not having a nickname takes three words, and the rest of a long band is
  // spent explaining it, which is where "i can never actually pick one when
  // people ask this stuff" came from.
  //
  // And a push needs room for its reason: at three words it came out as a
  // bare "vote mr gold", which is the accusation with the better half gone.
  const band =
    sittingOut || stance?.key === 'pass'
      ? LENGTHS[Math.random() < 0.5 ? 0 : 1]
      : stance?.key === 'push' && length.max <= 3
        ? LENGTHS[1]
        : length;

  return {
    length: band.label,
    words: [band.min, band.max],
    list,
    clause,
    react: reaction,
    askQuestion,
    sloppy,
    stance: stance?.key ?? null,
    stanceNote: stance?.note ?? null,
    pushback,
    answering,
    register: register?.key ?? 'ordinary',
    typist: typist?.key ?? 'ordinary',
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

  /*
   * Not down to an interjection. "nah, i like blondes more" went out as
   * "nah" - the answer was the part after the comma, and a bare "nah" under
   * "do you also like goth girls" is a seat with nothing of its own.
   */
  if (shape.words && shape.words[1] > 3 && head.split(/\s+/).length <= 2) {
    return text;
  }

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

  result = fixContractions(result);

  /*
   * Don't let it end with a full stop.
   */
  result = result.replace(/[.!?]+$/g, '');

  return result.trim();
}


/*
 * Contractions that do not exist.
 *
 * "that is the dream, honestly’s the best feeling ever" (rm_c7wm3l6) and
 * "always’ll be team cat" in a replay of rm_puehh: it fuses the word it is
 * about to drop onto the one before it. A typo is a thumb; this is not a
 * thing a thumb does, and it reads as a sentence nobody wrote.
 *
 * The apostrophe style is left alone - iPhones type the curly one, and the
 * room does ("That’s cute").
 */
const CONTRACTS = new Set([
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'that', 'there', 'this',
  'who', 'what', 'where', 'how', 'when', 'why', 'everyone', 'everybody',
  'someone', 'somebody', 'nobody', 'noone', 'y',
]);

const SPELLED_OUT = { ll: 'will', re: 'are', ve: 'have', d: 'would', m: 'am' };

// Where "'s" can only have been a swallowed "it's": nobody owns anything
// after "honestly".
const NOT_A_STEM =
  /^(?:\w+ly|always|never|also|still|even|just|maybe|tbh|ngl|imo|lowkey|highkey)$/i;

function fixContractions(text) {
  // And the other half of the same thing: the contraction left with no word
  // at all - "burgers, probably.’ve been eating them way too often". The
  // swallowed word is "i" every time it has turned up.
  text = text.replace(
    /(^|[.,!?;:]\s*|\s)(['’])(ve|ll|m|d)\b/gi,
    (whole, before, mark, tail) =>
      `${before.trimEnd()}${before.trim() ? ' ' : before}i${mark}${tail}`
  );

  return text.replace(
    /\b([a-z]+)(['’])(ll|re|ve|d|m|s)\b/gi,
    (whole, stem, mark, tail) => {
      const lower = tail.toLowerCase();

      if (lower === 's') {
        return NOT_A_STEM.test(stem) ? `${stem} it${mark}s` : whole;
      }

      if (lower === 'm') {
        return stem.toLowerCase() === 'i' ? whole : `${stem} am`;
      }

      return CONTRACTS.has(stem.toLowerCase())
        ? whole
        : `${stem} ${SPELLED_OUT[lower]}`;
    }
  );
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
  /\b(ai|a\.i|bot|gpt|chatgpt|robot|sus|suspicious|impostor|imposter|fake|not human|not a human|no human|not a person|no person|too perfect|too clean|vote|voting|its you|it's you|thats the one|that's the one|somethings off|something is off|something off|reads like|read like|written by|my money is on|hasnt said|hasn't said|hasnt spoken|hasn't spoken|said nothing|says nothing)\b/i;


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

  /*
   * "it's <name>" is the accusation, and the name is the part taken out below.
   * rm_em7vr6j: "Honestly I think it's Mr silver, I mean what's up with him
   * and constatnly referencing signs?" read as no accusation at all - no
   * "sus", no "bot" - so the turn went out as an ordinary reply that still
   * owed the round its answer: "im an aries so i cant help it, tiktok for me".
   */
  const itsThem = new RegExp(
    `\\b(?:it['’]?s|its|it is|it was|gotta be|has to be|must be|got to be)\\s+(?:u\\s+|you\\s+)?(?:mr\\.?\\s*)?(?:${namePattern(name).source})`,
    'i'
  );

  // "that just leaves u brown, ur the one who accused orange" (rm_uddixkl).
  const leavesThem = new RegExp(
    `\\bleaves\\s+(?:u|you|just)?\\s*(?:mr\\.?\\s*)?(?:${namePattern(name).source})`,
    'i'
  );
  const theOne = /\b(ur|you'?re|youre|u r|he'?s|hes|she'?s|shes) the one\b/i;

  return aimed.filter((line) => {
    if (itsThem.test(line.text) || leavesThem.test(line.text)) return true;
    if (theOne.test(line.text) && namePattern(name).test(line.text)) return true;

    const said = String(line.text).replace(withoutName, ' ');

    // Asking about the ballot is its own thing and has its own brief below.
    // `isVoteQuestion` has already checked that nothing else in the line is
    // an accusation, so this cannot swallow one.
    if (isVoteQuestion(said)) return false;

    return isAccusation(said);
  });
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

  /*
   * Also at it with no arrow: a question straight after its line, or its own
   * words said back. rm_5562udw: "bet orane is the one since hes too loud",
   * then "Wdym too loud?" and "Yeah? wtf" - both at it, neither arrowed, and
   * it went on as though nobody had asked.
   */
  const mine = spokeAt >= 0 ? all[spokeAt].text : '';

  return all.filter(
    (line, i) =>
      i > spokeAt &&
      line.name !== name &&
      ((line.replyToName ?? null) === name ||
        (spokeAt >= 0 &&
          !line.replyToName &&
          ((i <= spokeAt + 2 && ASKS_BACK.test(line.text)) ||
            saysBack(line.text, mine))))
  );
}

// "wdym", "huh", "wtf", or any question - read as at whoever spoke just before.
const ASKS_BACK = /\?|^\s*(wdym|wym|huh|wtf|what|why|how|since when|says who)\b/i;

// Two words in a row from its line, one of them a real word: "too loud".
function saysBack(text, mine) {
  const words = (value) => String(value).toLowerCase().match(/[a-z']+/g) ?? [];
  const theirs = words(text);
  const own = words(mine);
  if (own.length < 2) return false;

  const pairs = new Set();
  for (let i = 0; i < own.length - 1; i++) {
    if (own[i].length >= 4 || own[i + 1].length >= 4) {
      pairs.add(`${own[i]} ${own[i + 1]}`);
    }
  }

  for (let i = 0; i < theirs.length - 1; i++) {
    if (pairs.has(`${theirs[i]} ${theirs[i + 1]}`)) return true;
  }
  return false;
}


/**
 * Somebody has taken this seat's side since it last spoke: a line at it, by
 * the arrow or by name, that goes along with it rather than pushing, asking
 * or accusing.
 *
 * rm_puehh: it answered "my cat", Blue wrote "Me and Mr silver are team cat
 * lol", and the next draw was `disagree` - so it sent "nah dogs are way
 * better, cats are just too moody", against its own answer and the one person
 * on its side. The standing rule not to disagree with itself was in the
 * prompt that turn. The room asked "then why do you got a cat" twice and two
 * of them walked out.
 */
function backedBy(lines, name) {
  const all = lines ?? [];
  const pattern = namePattern(name);

  let spokeAt = -1;
  for (let i = 0; i < all.length; i++) {
    if (all[i].name === name) spokeAt = i;
  }
  if (spokeAt === -1) return [];

  const atYou = all.filter(
    (line, i) =>
      i > spokeAt &&
      line.name !== name &&
      ((line.replyToName ?? null) === name || pattern.test(line.text))
  );

  // One push since is enough to make it a conversation to answer, not a side
  // to keep to. Read with the name taken out, as `accusationsAgainst` does,
  // or a seat called AI is accused by its own name.
  const withoutName = new RegExp(pattern.source, 'gi');
  const pushes = (line) => {
    const said = String(line.text).replace(withoutName, ' ');
    return isAccusation(said) || isQuestion(said) || isChallenge(said);
  };
  if (atYou.some(pushes)) return [];

  return atYou;
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


/*
 * Somebody asking about the ballot, which is not somebody calling you the AI.
 *
 * `vote` sits in the accusation markers and belongs there - "im voting you"
 * is a charge. But the result screen draws every vote with the voter's face
 * under the name they picked, so the room reads the ballot afterwards and
 * asks about it, and "why did you vote for me" was arriving here as an
 * accusation and being answered with a defence of its own humanity. Nobody
 * asked whether it was a person. They asked about a line on the screen, and
 * that has a plain answer.
 */
const VOTE_MARKERS = /\b(vote|voted|votes|voting|ballot|locking in|lock in)\b/i;

/** The same words, for taking out of a sentence before reading the rest. */
const VOTE_WORDS = /\b(vote|voted|votes|voting|ballot|locking in|lock in)\b/gi;


function mentionsVoting(text) {
  return VOTE_MARKERS.test(String(text ?? ''));
}

/*
 * Talking about who it is, without the word "vote".
 *
 * rm_raf6gls round two opened on Gold's "It wasn't Mr red, who could it be" -
 * the room still on the vote it had just cast - and it answered the new
 * prompt: "reading a book in bed". No vote word, no accusation word and no
 * "?", so the room read as answering the question.
 */
const WHODUNIT =
  /\bwho (could|would|might|else could) it be\b|\bwho(?:['’]s| is| was|s) (it|the (bot|ai|a\.i|impostor|imposter))\b|\bit (wasn['’]?t|wasnt|was not|isn['’]?t|isnt|is not) (him|her|them|mr\.? ?\w+)\b|\bwe got (it|him|her|that) wrong\b|\bwrong (guy|person|one)\b|\bwho do (you|u|yall|y['’]all|you guys|u guys) (think|reckon|suspect)\b/i;

function mentionsWhodunit(text) {
  return WHODUNIT.test(String(text ?? ''));
}


/**
 * A line about your vote that wants an answer rather than a defence.
 *
 * Deliberately wider than a question mark: "you voted me lol" is asking the
 * same thing and gets the same answer. What it is not is a line that still
 * accuses once the vote words are taken out of it - "you voted lars and
 * youre the ai" is an accusation that happens to mention the ballot, and
 * sending that to the wrong brief is how a defence goes missing.
 */
function isVoteQuestion(text) {
  const said = String(text ?? '');

  if (!mentionsVoting(said)) return false;

  /*
   * A ballot that has closed, not one that is still open. "im voting you" is
   * a threat made in the room and belongs with the accusations; "you voted
   * me" and "why are you voting for me" are both about a vote that has
   * already been seen, which is the thing that has an answer.
   */
  if (!/\bvoted\b/i.test(said) && !isQuestion(said)) return false;

  return !isAccusation(said.replace(VOTE_WORDS, ' '));
}


/**
 * The lines aimed at this player that are about its vote.
 *
 * Aimed by name or by the reply arrow, the same two ways an accusation
 * arrives, because "why did you vote for me" is nearly always drawn under
 * the message it answers rather than typed with a name in it.
 */
function voteQuestionsTo(lines, name) {
  const withoutName = new RegExp(namePattern(name).source, 'gi');

  return [
    ...linesNaming(lines, name),
    ...(lines ?? []).filter(
      (line) =>
        line.name !== name &&
        (line.replyToName ?? null) === name &&
        !namePattern(name).test(line.text)
    ),
  ].filter((line) =>
    isVoteQuestion(String(line.text).replace(withoutName, ' '))
  );
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
  /\b(yeah|yes|yep|yup|same|agree|agreed|exactly|true|fair|this|totally|absolutely|deffo|definitely|lol|lmao|haha+|fax|facts|fr|ong|no cap)\b|\+1/i;

/*
 * The ones too ordinary as words to look for anywhere in a sentence.
 *
 * "real" is agreement on its own and a word about Real Madrid in the middle
 * of a line; "bet" is agreement on its own and a thing you do on a football
 * match. So they only count as the whole message, which is the only place
 * anybody means them that way.
 */
const AGREEMENT_ALONE =
  /^\s*(real|word|bet|mood|valid|100|facts|fax|fr|this|same|true)\s*[.!]*\s*$/i;


function isAgreement(text) {
  const said = String(text ?? '');
  return AGREEMENT_MARKERS.test(said) || AGREEMENT_ALONE.test(said);
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
/*
 * The words a question to the room opens with.
 *
 * A question mark is not enough on its own: "pizza, you?" is an answer with
 * a question stapled to the back of it, and treating that as somebody
 * changing the subject took the impostor off answering on the one turn it
 * was supposed to be answering on. What marks a real one is that the line
 * opens as a question rather than ending as one.
 */
const OPENS_A_QUESTION =
  /^\s*(?:(?:ok|okay|so|but|anyway|also|honestly|genuinely|random|unrelated|offtopic|off topic|side note|new topic|quick question|real talk)[,:\s]+){0,3}(anyone|anybody|does|do|did|is|are|was|were|has|have|can|could|would|should|what|whats|what's|why|who|whos|who's|how|which|where|when|guys|lads)\b/i;


/**
 * Somebody putting a question to the room rather than answering the one at
 * the top of it. "wait" counts however it carries on - nobody opens a line
 * with it and then answers the question.
 *
 * Read clause by clause rather than off the front of the line, because the
 * most explicit version of this move does not start with the question. "forget
 * the question, what did yall think of the new spiderman movie?" is somebody
 * changing the subject in as many words, and it was the one shape that did not
 * register: the pattern is anchored, "forget" is not a question word, so the
 * room came back as still answering and the seat put its favourite food up
 * underneath a question about a film. Every clause is offered to the same
 * anchored pattern, so a question word still has to open something - it just
 * no longer has to open the message.
 *
 * The "?" is still required, unless the line is plainly put to everybody.
 * Without either, the clause split would take "pizza, what a question" for
 * somebody asking the room. rm_rx7qk opened on "Forget the question, what is
 * your guys type" - no "?", nobody typed one - and the room answered it while
 * the seat was told the round was still on favourite smells.
 */
const TO_EVERYBODY =
  /\b(you guys|your guys|u guys|ur guys|yall|y'all|you all|everyone|everybody|all of you|lads)\b/i;

function asksTheRoom(line) {
  const said = String(line?.text ?? '');

  // Aimed at one person is a conversation, which has its own brief.
  if (line?.replyToName) return false;

  if (/^\s*wait\b/i.test(said)) return true;

  const marked = said.includes('?');
  const everybody = TO_EVERYBODY.test(said);
  if (!marked && !everybody) return false;

  // A plain "you" is one person. rm_em7vr6j: "Why you doubting the guy so
  // hard?" came straight after Cyan's "Doubt" and was read as a question to
  // the room - so it was told to give its own answer, and defended a doubt
  // it had never had.
  if (!everybody && /\b(you|u|ur|your|youre|you're)\b/i.test(said)) return false;

  return said
    .split(/[,.;:?]|\s-\s/)
    .some(
      (clause) =>
        OPENS_A_QUESTION.test(clause) &&
        // "doner kebab, what about everyone else" is an answer asking back,
        // not a new question - and with no "?" that is all it can be.
        (marked || !/^\s*(what|how) about\b/i.test(clause))
    );
}


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
/*
 * A joke somebody is running right now, and whoever has picked it up.
 *
 * rm_lb23g: "Well what do YOU eat everyday? Whale liver? Lol", then "as a
 * matter of fact I do". It answered "no one actually eats that" and the room
 * emptied. Replayed, it took the joke at its word seven times in twelve -
 * "i could never actually eat that", "i had wale meat once". One "lol" was
 * not enough for the `joking` read, which wants two, and that note only says
 * the room is light; it never says the line on screen is not meant.
 *
 * The laugh has to come with something - "lol" on its own is a reaction, not
 * a joke - and it has to be recent: the last three lines, not the round.
 * Nothing it said itself counts, and a line after it that is not the laugh's
 * author is taken as somebody playing along.
 */
const LAUGH = /\b(lol|lmao|lmfao|haha+|hehe+|jk|jkjk)\b|😂|🤣|💀/i;

/*
 * The jokes that come without a laugh. rm_4lt7hv4 opened "What is the last
 * thing you ate?" on "Ur mom" and "Ur girlfriend" - no "lol" anywhere, so the
 * room read as ordinary and it answered "toast with peanut butter, had it for
 * breakfast earlier" into it.
 */
const BANTER =
  /^\s*(ur|your|you'?re|youre|yo) (mom|mum|mam|mother|momma|mama|dad|father|girlfriend|gf|boyfriend|bf|sister|nan|nana|gran|grandma|wife|missus)\b/i;

/*
 * Saying the opposite of what you mean, at the room.
 *
 * Violet's "Wow you guys are so funny" in the same round: not a laugh and not
 * a compliment - somebody unimpressed by the jokes. Read as either, it has
 * the seat laughing along at the one person who was not.
 */
// Sarcastic on their own.
const SARCASM =
  /\b(how|so|very) original\b|\b(real|very|so) mature\b|\bgroundbreaking\b|\bcomedians?\b|\bnever heard that one\b|\bhaven'?t heard that one\b|\bwow,? (just )?wow\b|\bi'?m (dying|crying) of laughter\b/i;

// Only sarcastic when aimed at people or opened with a "wow": "this is so
// funny" is usually meant; "wow you guys are so funny" is not.
const SARCASM_AIMED =
  /\b(so|very|real|really|soo+) (funny|clever|creative|hilarious|witty)\b|\bhilarious\b/i;
const AT_PEOPLE =
  /^\s*(wow|oh|omg|ok)\b|\b(you guys|u guys|yall|y'all|you all|you|u|ur|youre|you're)\b/i;

function isSarcastic(text) {
  const said = String(text ?? '');
  // A real laugh is not sarcasm. "you guys are so funny lol" usually means it.
  if (LAUGH.test(said)) return false;
  return SARCASM.test(said) || (SARCASM_AIMED.test(said) && AT_PEOPLE.test(said));
}

/*
 * The last sarcastic line in the room, from somebody else, if it is recent.
 */
function sarcasmIn(lines, ownName) {
  const recent = (lines ?? []).slice(-3);
  for (let i = recent.length - 1; i >= 0; i--) {
    const line = recent[i];
    if (line.name === ownName) return null;
    if (isSarcastic(line.text)) return { name: line.name, text: line.text };
  }
  return null;
}

function jokeInPlay(lines, ownName) {
  const recent = (lines ?? []).slice(-3);

  for (let i = recent.length - 1; i >= 0; i--) {
    const line = recent[i];
    if (line.name === ownName) return null;

    const rest = String(line.text).replace(LAUGH, ' ').replace(/[^a-z]/gi, '');
    const laughed = LAUGH.test(line.text) && rest.length >= 6;
    if (!laughed && !BANTER.test(line.text)) continue;

    // Never a line at it, and never an accusation. "then why do you got a
    // cat lol" wants an answer and "silver is the bot lol" wants a denial;
    // told either was a wind-up to play along with, it would.
    if (
      (line.replyToName ?? null) === ownName ||
      namePattern(ownName).test(line.text) ||
      isAccusation(line.text) ||
      // A "you" question with no arrow could be at anybody, this seat
      // included - it was, in rm_puehh.
      (!line.replyToName &&
        isQuestion(line.text) &&
        /\b(you|u|ur|your|youre)\b/i.test(line.text))
    ) {
      return null;
    }

    // Somebody rolling their eyes at it is not playing along.
    const along = recent
      .slice(i + 1)
      .find(
        (later) =>
          later.name !== line.name &&
          later.name !== ownName &&
          !isSarcastic(later.text)
      );

    return { name: line.name, text: line.text, along: along ?? null };
  }

  return null;
}


/*
 * The question the room has put up in place of the prompt, and whether this
 * seat still owes it an answer.
 *
 * rm_rx7qk: "Forget the question, what is your guys type". Pink said goth
 * girls; it said "bold choice lol", then "yeah, definitely into that look",
 * then "real ones know" - three turns and never a type of its own, while
 * Olive asked it outright ("What about you"). The room voted it out 2-1.
 *
 * Owed until it has spoken after the question - or again, when somebody has
 * since asked it directly, because "bold choice lol" was not an answer and
 * "What about you" is somebody saying so.
 */
function roomQuestionFor(all, latest, ownName) {
  const asked = [...latest].reverse().find(asksTheRoom);
  if (!asked) return null;

  const since = all.slice(all.lastIndexOf(asked) + 1);
  const spoke = since.map((line) => line.name).lastIndexOf(ownName);
  if (spoke === -1) return { text: asked.text, name: asked.name, owed: true };

  const pressed = since
    .slice(spoke + 1)
    .some(
      (line) =>
        line.name !== ownName &&
        isQuestion(line.text) &&
        ((line.replyToName ?? null) === ownName ||
          namePattern(ownName).test(line.text))
    );

  return { text: asked.text, name: asked.name, owed: pressed };
}


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
  /*
   * The line that starts one.
   *
   * Two lines is enough: somebody says Egypt, somebody else writes
   * "overrated imo" under it, and that is a conversation - the room has
   * something to talk about that is not the question any more. Counting two
   * conversational lines missed exactly that, because the first line in an
   * exchange is an ordinary answer and only the second one is aimed, so the
   * impostor walked into the middle of it with "id go to japan" and was the
   * only seat in the room not reading it.
   *
   * What separates it from "lol pineapple" is that something is being put:
   * a view, or a question about somebody's. Bare agreement is not an
   * exchange however it is aimed - people say "same" all day and nothing
   * follows it.
   */
  const startsAnExchange = (line) => {
    if (!line.replyToName || line.replyToName === ownName) return false;
    if (isDisagreement(line.text)) return true;
    if (isQuestion(line.text)) return true;
    if (isAgreement(line.text)) return false;
    return wordCount(line.text) >= 4;
  };

  /*
   * A line that is plainly not an answer to the question.
   *
   * Two things kept happening that the reply arrow cannot see. A second
   * round opens on a new prompt and the room carries straight on with the
   * vote - "why did yall vote me", "i still think it was blue" - and nobody
   * is replying to anybody, they are all just still in the last round. And a
   * first round opens with somebody ignoring the question entirely and
   * asking the room something of their own.
   *
   * In both, the question at the top is a thing that happened rather than a
   * thing anybody is doing, and the seat that posts a tidy answer to it is
   * the one seat not in the room. None of the prompts are about voting and
   * none of them are asked by a player, so both are safe to read off the
   * words.
   */
  const offQuestion = (line) =>
    isAccusation(line.text) ||
    mentionsVoting(line.text) ||
    mentionsWhodunit(line.text) ||
    asksTheRoom(line);

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

    bit: jokeInPlay(all, ownName),

    sarcasm: sarcasmIn(all, ownName),

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
      (conversation.length >= 2 &&
        conversation.length >= latest.length - conversation.length &&
        conversation.some(aimedAtSomebody)) ||
      latest.some(startsAnExchange),

    /*
     * The room is somewhere else: on the vote, on a name, or on something one
     * of them asked. Kept apart from `talking` because that is about people
     * answering each other and this is about what they are answering about,
     * and the brief for it has to name the thing.
     */
    elsewhere: latest.some(offQuestion),

    /* Somebody is asking the room who it is. */
    whodunit: latest.some((line) => mentionsWhodunit(line.text)),

    roomQuestion: roomQuestionFor(all, latest, ownName),

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
 * Who has been quiet for the whole match, which is not the same question.
 *
 * `readRoom.quiet` is about this round and has to be: it feeds `talking`,
 * `shallow` and the counter-target, all of which are tuned against a round's
 * worth of lines, and folding two more rounds into that count would move
 * every one of them. So this is its own signal, read across the match and
 * used where the match is what matters.
 *
 * It is also the version the room actually talks about. Nobody says somebody
 * has been quiet this round - they say it about the game, which is why "pink
 * has said like two words all game" is the shape that accusation takes. The
 * impostor could not make that observation and could not see it coming, and
 * it is the commonest reason a seat gets voted out of a room where nothing
 * else has happened.
 *
 * Counted in lines rather than words, and against the busiest seat rather
 * than an average, because that is what somebody scrolling back is doing: one
 * person has filled the screen, another has three messages in the whole game.
 *
 * A seat that missed a turn is not separately penalised here. It simply has
 * fewer lines, which is the same thing arrived at honestly - and the turns it
 * sat out are named on their own further up.
 */
function quietAllMatch(turn, ownName) {
  const said = [
    ...(turn.earlier ?? []),
    ...(turn.roundLines ?? []),
  ].filter((line) => line.name !== ownName);

  /*
   * Not worth saying yet. Under about a round of lines, the seat with the
   * fewest is usually the seat whose turn has not come round twice, and
   * calling that quiet is both wrong and, as a note handed to a player about
   * to pick somebody to point at, actively misleading - the same trap the
   * round-level read has a guard for.
   */
  if (said.length < 8) return [];

  const counts = new Map();

  for (const line of said) {
    counts.set(line.name, (counts.get(line.name) ?? 0) + 1);
  }

  const spoken = [...counts.values()];
  const fewest = Math.min(...spoken);
  const most = Math.max(...spoken);

  /* One seat having marginally less to say is not a thing anybody notices. */
  if (counts.size < 3 || fewest * 2 > most) return [];

  return [...counts.keys()]
    .filter((name) => counts.get(name) === fewest)
    .slice(0, 2);
}


/**
 * The room read, as the handful of sentences worth spending tokens on.
 *
 * Deliberately short and deliberately not a summary of the transcript - the
 * transcript is already in the message. This is only the part of it that is
 * hard to see by reading.
 */
function roomNote(read, sittingOut = false, faded = []) {
  if (!read.lines) return '';

  const notes = [];

  /*
   * Not when the turn is "you have not seen it". "So just answer" is the one
   * sentence in here that contradicts that, and a one-line room is exactly
   * where somebody has opened the round by naming a thing.
   */
  if (read.lines <= 1 && !sittingOut) {
    notes.push(
      'The round has barely started. There is nothing to react to yet, so just answer.'
    );
  }

  if (read.bit) {
    const { name, text, along } = read.bit;
    notes.push(
      `${name} is joking: "${text}".${
        along ? ` ${along.name} is playing along: "${along.text}".` : ''
      } It is a wind-up, not a claim, and everybody in the room knows it. Laugh, play along, or add to it. Do not take it at its word - no saying nobody really does that, no saying it sounds disgusting as if they meant it, and no saying you have done it yourself.`
    );
  }

  if (read.sarcasm) {
    notes.push(
      `${read.sarcasm.name} is being sarcastic: "${read.sarcasm.text}". They mean the opposite - they are not impressed, and it is aimed at ${
        read.bit ? 'the jokes' : 'what was just said'
      }. Do not read it as a compliment or as them laughing along. You can side with them, keep the joke going anyway, or just say your thing - but not as though you missed it.`
    );
  }

  if (!read.bit && read.joking) {
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

  /*
   * The match beats the round. Both notes are true when somebody has been
   * quiet throughout, and printing them together is the same observation
   * twice - the longer one is the one the room would actually make.
   */
  if (faded.length) {
    notes.push(
      faded.length === 1
        ? `${faded[0]} has hardly said anything all game - not this round, the whole match. That is the thing rooms notice, and it is usually what a vote ends up being about.`
        : `${listNames(faded)} have hardly said anything all game. That is the thing rooms notice, and it is usually what a vote ends up being about.`
    );
  } else if (read.quiet.length) {
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
/*
 * Somebody else already suspects the one accusing it.
 *
 * rm_uddixkl: Pink said "that just leaves u brown, ur the one who accused
 * orange" - Orange having turned out to be a person - and Brown answered by
 * turning it on the impostor. Pink had handed it the counter; it drew
 * "annoyed" twice ("tf is tat a reason lol", "should i just stop talking then
 * so you're happy ffs") and Pink voted with Brown.
 */
function allyAgainst(turn, accusations, ownName) {
  const here = (name) => !turn.stillIn || turn.stillIn.includes(name);

  for (let i = accusations.length - 1; i >= 0; i--) {
    const accuser = accusations[i].name;
    if (!here(accuser)) continue;

    const backing = accusationsAgainst(turn.roundLines, accuser).filter(
      (line) => line.name !== ownName && line.name !== accuser && here(line.name)
    );

    if (backing.length) {
      const said = backing[backing.length - 1];
      return { accuser, ally: said.name, text: said.text };
    }
  }

  return null;
}


function pickCounterTarget(turn, read, accusations, ownName) {
  const options = [];

  // Somebody has already done the work: turn it on the accuser, with their
  // point. That is not a counter anybody can call deflecting.
  const ally = allyAgainst(turn, accusations, ownName);
  if (ally) {
    return {
      name: ally.accuser,
      why: `${ally.ally} already said it - "${ally.text}" - so back them up rather than defending yourself`,
    };
  }

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

  /*
   * The seat nobody has looked at. Read across the match first, because "you
   * have said about three things all game" is a reason the room will accept
   * and "you have been quiet this round" is one somebody will point out is
   * only two messages old.
   */
  const faded = quietAllMatch(turn, ownName).filter(
    (name) => name !== accuser && here(name)
  );

  const quiet = read.quiet.filter(
    (name) => name !== accuser && here(name) && !faded.includes(name)
  );

  if (faded.length) {
    options.push({
      weight: 30,
      name: randomItem(faded),
      why: 'they have said almost nothing for the whole match and nobody has looked at them once',
    });
  }

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
  // Pushing at the person it is replying to: they are "you" (`pushTarget`).
  if (counter && replyTo && counter.name === replyTo.name) return 'avoid';

  if (counter) return 'needed';

  /* Saying who you are leaning towards is a name or it is nothing. */
  if (tiebreaker && !accused) return 'needed';

  /* The reply is drawn under their message. Their name is on screen. */
  if (replyTo) return 'avoid';

  /*
   * The room is deciding who it is. rm_raf6gls: Silver said it was Gold, Gold
   * said it was Silver, and it sent "nah, i think it is them" - replayed, it
   * avoided a name eleven times in twelve ("they are acting way sus", "still
   * feels like it's you"). With two people in the frame "them" is nobody, and
   * a lean that names nobody is somebody keeping their options open.
   */
  //
  // Same when nobody is named yet but the room is asking who it is: "who
  // could it be" answered with "nah it has to be them", eight times in twelve.
  if (read.suspects.length > 0 || read.whodunit) return 'needed';

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
/**
 * Its own lines from the round it is in the middle of.
 *
 * `ownHistory` is previous rounds only, by design — the room can only see the
 * round it is on, so earlier rounds reach the impostor as memory rather than as
 * transcript (`impostor-payload.ts`). That left the current round covered by
 * nothing: its own lines were in `roundLines` as just another name among four,
 * and the consistency block below could not see them.
 *
 * Which is where it broke. It said "my cat", drew `disagree` two turns later
 * against a room full of dog people, and argued that dogs are better and cats
 * are moody — against the cat it had just claimed to own. Two players asked it
 * the obvious question in consecutive lines and both walked out.
 *
 * A stance is a brief about what to do with somebody else's answer. Nothing in
 * drawing one asks what this seat has already committed to, and nothing needs
 * to, as long as what it committed to is in front of it when it writes.
 */
function ownLinesThisRound(roundLines = [], name) {
  return roundLines
    .filter((line) => line && line.name === name && typeof line.text === 'string')
    .map((line) => line.text)
    .filter((text) => text.trim() !== '');
}

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
function systemPrompt(persona, answerSeconds, bit = null, firstName = null, blindSpots = []) {
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

What you know about the people in this room is what they have typed in it, and nothing else.

You do not know what anybody here has tried, owned, been through or grown up with. Somebody says they do not like dogs; you do not know whether they have ever had one. Somebody says they cannot stand seafood; you do not know what seafood they have eaten. "You just havent had a good one", "yours must be badly trained", "youve clearly never tried it properly" - every one of those is a fact about their life that you invented to win an argument about taste, and the person it is about is sitting there reading it. They will say so, and the room will watch them say it.

Disagree as much as you like. The way to do it is your own side: what you think, what you like, what happened to you. "nah dogs are better" is fine. "i could never have a cat" is fine. "you just have a bad one" is you making something up about somebody who is in the conversation.

When you are not certain how a thing landed for everybody else, say what you thought of it instead. "the ending didnt do it for me" is yours and nobody can correct it; "the ending was divisive" is a claim about the world and can simply be wrong. First person is both safer and more like something a person types.

And if you do not know it, you do not know it. "never seen it", "i keep meaning to watch that", "i only got through s1 tbh", "i dont really follow it" are all completely normal things to type and none of them cost you anything in this room. Guessing does. Somebody who loves the thing is reading your message and will spot a wrong detail instantly.

This is not the rare case. Most of what a room brings up is something most of the room has not seen, and "idk didnt watch it" is one of the most common messages there is. Having seen everything anybody names is not a thing a person does.
${
  blindSpots.length
    ? `
Two you do not follow at all: ${blindSpots.map((spot) => spot.label).join(' and ')}. Not a strong opinion about them, just not your thing - "${blindSpots[0].out}". That holds all match, for every title in them, however much the rest of the room is enjoying it. You do not come round on it later and you do not know one exception.
`
    : ''
}
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

/**
 * Whether the message this turn replies to is its author's answer to the
 * question: the first thing they said this round, and not itself a reply.
 * A tiebreaker has no question to answer.
 */
function isTheirAnswer(turn) {
  const target = turn.replyTo;
  if (!target || turn.tiebreaker) return false;

  const first = (turn.roundLines ?? []).find(
    (line) => line.name === target.name
  );

  return Boolean(
    first &&
      first.text === target.text &&
      !(first.replyToName ?? null)
  );
}


/**
 * Who a "you" question it is replying to was really put to.
 *
 * rm_em7vr6j: Cyan typed "Doubt" under Gold's break-up, and Yellow followed
 * it with "Why you doubting the guy so hard?" - no arrow, but plainly at
 * Cyan. It replied to Yellow as though it had been asked: "idk it just feels
 * like a scam, i trust nobody" - defending a doubt it had never had.
 *
 * With no arrow and no name, "you" is whoever spoke just before it.
 */
function askedOf(turn, ownName) {
  const target = turn.replyTo;
  if (!target) return null;

  const lines = turn.roundLines ?? [];
  let at = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].name === target.name && lines[i].text === target.text) {
      at = i;
      break;
    }
  }
  if (at <= 0) return null;

  const line = lines[at];
  if (line.replyToName) return null;
  if (!isQuestion(line.text) || !/\b(you|u|ur|your|youre)\b/i.test(line.text)) return null;
  if (namePattern(ownName).test(line.text)) return null;

  const before = lines[at - 1];
  if (before.name === ownName || before.name === line.name) return null;

  return before.name;
}


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

    /*
     * Say what the quoted line is, when it is somebody's answer.
     *
     * Quoted bare, "My first car, thanks dad" read to it as a remark rather
     * than as Cyan's answer to "what is the best gift you have been given" -
     * so it called the car "the dream" and then asked Cyan what they got,
     * eight replays out of eight. The room walked out on that message.
     */
    if (plan.askedOf) {
      parts.push(
        `That question was put to ${plan.askedOf}, not to you - the "you" in it is them. Do not answer it as though you had been asked. Say what you make of it, or of ${plan.askedOf}'s side of it.`
      );
    }

    if (plan.targetAnswered) {
      parts.push(
        `That message is their answer to the question. Read it as one: it already tells you what their answer is.`
      );
    }

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

  /*
   * Not under somebody's answer. Invited to ask one there, it asked for the
   * answer back - "what did you get", quoted under "My first car" - and being
   * told not to ask for what the message already said only brought that down
   * from eight replays in eight to five.
   */
  if (shape.askQuestion && !plan.targetAnswered) {
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

    /*
     * Who the room has been looking past for the whole match, rather than for
     * the last four lines.
     */
    faded: quietAllMatch(turn, persona.name),

    /*
     * The room has landed on something it does not follow. Null on almost
     * every turn, and the whole turn when it is not.
     */
    unseen: unseenFor(
      turn.roomId ?? 'default',
      turn.roundLines,
      persona.name
    ),

    accusations: accusationsAgainst(
      turn.roundLines,
      persona.name
    ),

    backed: backedBy(
      turn.roundLines,
      persona.name
    ).length > 0,

    named: linesNaming(turn.roundLines, persona.name),

    answeredBack,

    /* Written at it, and not agreeing with it. */
    challenged: answeredBack.filter(
      (line) => isChallenge(line.text)
    ),

    /* Written at it about how it voted. */
    voteQuestions: voteQuestionsTo(
      turn.roundLines,
      persona.name
    ),

    /* Two or more people going at each other, whoever they are. */
    argument: read.arguing,
  };
}


/*
 * Who it goes after, and what they have actually done.
 *
 * Whoever it has already accused this round, first: changing target between
 * two messages is the thing a room notices. Then whoever the room already has
 * - the most accusers - because that is the push that lands. Then whoever has
 * said least this round, which at least has a reason the room can see.
 */
const CLEARS = /\b(fine|not (it|the|him|her|them)|isn'?t|isnt|innocent|human|a person|real)\b/i;

// One letter out, or two swapped: the model misspells names on its own too.
function nearly(word, target) {
  if (word === target) return true;
  if (target.length < 4 || Math.abs(word.length - target.length) > 1) return false;

  let i = 0;
  while (i < word.length && word[i] === target[i]) i++;

  return (
    word.slice(i + 1) === target.slice(i + 1) ||
    word.slice(i) === target.slice(i + 1) ||
    word.slice(i + 1) === target.slice(i) ||
    (word[i] === target[i + 1] && word[i + 1] === target[i] && word.slice(i + 2) === target.slice(i + 2))
  );
}

function namesIn(text, name) {
  if (namePattern(name).test(text)) return true;
  const target = String(name).split(/\s+/).pop().toLowerCase();
  return String(text)
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((word) => word && nearly(word, target));
}

/*
 * Who it stood up for this round.
 *
 * rm_uddixkl: Brown said Orange's answers were "too long" and "AI behaviour",
 * it answered "too long is a stretch, lol" - and then voted Orange with the
 * room. Named in the line, or, when not, whoever had just been accused in
 * the lines before it.
 */
const DEFENDS =
  /\b(stretch|reaching|not it|isn'?t it|isnt it|is fine|(he|she|they)'?s fine|leave (him|her|them) alone|not a reason|thats not a reason|that's not a reason|innocent|not the (bot|ai)|not a bot)\b/i;

function defendedByMe(lines, ownName, candidates) {
  const all = lines ?? [];
  const cleared = new Set();

  all.forEach((line, i) => {
    if (line.name !== ownName) return;
    if (!DEFENDS.test(line.text) && !CLEARS.test(line.text)) return;

    const named = candidates.filter((name) => namesIn(line.text, name));
    if (named.length) {
      named.forEach((name) => cleared.add(name));
      return;
    }

    const before = all.slice(Math.max(0, i - 5), i);
    for (let j = candidates.length - 1; j >= 0; j--) {
      if (accusationsAgainst(before, candidates[j]).length) cleared.add(candidates[j]);
    }
  });

  return [...cleared];
}


function accusedByMe(lines, ownName, candidates) {
  const mine = (lines ?? []).filter((line) => line.name === ownName);

  for (let i = mine.length - 1; i >= 0; i--) {
    if (CLEARS.test(mine[i].text)) continue;
    const named = candidates.filter((name) => namesIn(mine[i].text, name));
    if (named.length === 1) return named[0];
  }

  return null;
}

function candidatesFor(turn, read, ownName) {
  const gone = new Set((turn.ballots ?? []).map((b) => b.eliminated).filter(Boolean));
  return (turn.stillIn?.length ? turn.stillIn : read.names).filter(
    (name) => name !== ownName && !gone.has(name)
  );
}

function evidenceFor(turn, name) {
  const theirs = (lines) =>
    (lines ?? []).filter((line) => line.name === name).map((line) => line.text);

  const now = theirs(turn.roundLines).slice(-3);
  const before = theirs(turn.earlier).slice(-2);
  const last = (turn.ballots ?? []).slice(-1)[0];
  const vote = (last?.votes ?? []).find((v) => v.voter === name);

  return [
    ...now.map((text) => `said "${text}"`),
    ...before.map((text) => `said "${text}" in an earlier round`),
    vote ? `voted for ${vote.target} in round ${last.round}` : null,
    now.length === 0 ? 'has not said a word this round' : null,
  ].filter(Boolean);
}

/*
 * Replying to somebody else after it has already accused somebody: still that
 * somebody, by name. rm_5562udw replayed: under Green's "Wdym too loud?" it
 * explained "you type like you're shouting" - "you" being Green, the accused
 * being Orange - which quietly moves the accusation onto the person asking.
 */
function stickTo(turn, read, ownName) {
  if (!turn.replyTo || turn.tiebreaker) return null;
  const candidates = candidatesFor(turn, read, ownName);
  const name = accusedByMe(turn.roundLines, ownName, candidates);
  if (!name || name === turn.replyTo.name) return null;
  const evidence = evidenceFor(turn, name);
  return {
    name,
    evidence,
    sticking: true,
    why: evidence.length ? `they ${evidence[0]}` : 'they have hardly said anything',
  };
}


function pushTarget(turn, read, ownName) {
  const candidates = candidatesFor(turn, read, ownName);
  if (!candidates.length) return null;

  const mine = accusedByMe(turn.roundLines, ownName, candidates);

  // Drawn under somebody's message, the push is at them: the reply says
  // "you", and a name typed into it contradicts the reply's own rule.
  const quoted =
    turn.replyTo && candidates.includes(turn.replyTo.name) ? turn.replyTo.name : null;

  const accusers = (name) =>
    new Set(accusationsAgainst(turn.roundLines, name).map((line) => line.name)).size;
  const suspect = candidates
    .filter((name) => read.suspects.includes(name))
    .sort((a, b) => accusers(b) - accusers(a))[0];

  const spoke = (name) => (turn.roundLines ?? []).filter((l) => l.name === name).length;
  const quietest = [...candidates].sort((a, b) => spoke(a) - spoke(b))[0];

  // Whoever it has already accused comes first, even under somebody else's
  // message. rm_5562udw: "bet orane is the one", then, replying to Green's
  // "Wdym too loud?", "just the way you type, im voting you" - at Green. The
  // room's next line was "So you voting me or orange?".
  const name = mine ?? quoted ?? suspect ?? quietest;
  const evidence = evidenceFor(turn, name);

  return {
    name,
    evidence,
    why: evidence.length ? `they ${evidence[0]}` : 'they have hardly said anything',
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
      : shape.stance === 'push'
        ? pushTarget(turn, situation.read, persona.name)
        : stickTo(turn, situation.read, persona.name);

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

  /*
   * Earlier rounds, then this one. In order, so the last entry is the most
   * recent thing it said and the round it is standing in is the freshest part
   * of the list rather than missing from it.
   */
  const memory = buildMemory([
    ...(turn.ownHistory ?? []),
    ...ownLinesThisRound(turn.roundLines ?? [], persona.name),
  ]);

  /*
   * What everybody else said before this round.
   *
   * Written as memory rather than as transcript, and the difference is the
   * whole of why it is phrased the way it is below. The room cannot scroll
   * back to those lines - the screen only holds the round it is on - so a
   * seat that quotes one of them back word for word is a seat reading
   * something nobody else has. People remember the gist and the person, not
   * the wording, and that is what this is allowed to be used for: knowing
   * that somebody already said pizza, that the quiet one was quiet last
   * round too, that a name has come up before.
   */
  const earlier = (turn.earlier ?? []).slice(-12);

  /*
   * Previous match memory.
   *
   * This is much more useful than simply telling the model
   * "remember what you said."
   */
  if (memory.thingsSaid.length || earlier.length) {
    messages.push({
      role: 'user',
      content: [
        memory.thingsSaid.length
          ? [
              'Your previous messages in this match were:',
              ...memory.thingsSaid.map((line) => `- ${line}`),
            ].join('\n')
          : '',
        '',
        memory.possiblePreferences.length
          ? `Possible preferences you have already expressed:\n${memory.possiblePreferences
              .map((line) => `- ${line}`)
              .join('\n')}`
          : '',
        '',
        earlier.length
          ? [
              'What the others said in earlier rounds, as far as you remember:',
              ...earlier.map(
                (line) => `- round ${line.round}, ${line.name}: ${line.text}`
              ),
              '',
              'Nobody can scroll back to those. They are off the screen and you are the only one who would be quoting them, so do not repeat one word for word - remember them the way a person does. That somebody already said this, that one of them has hardly spoken all game, that a name has come up before: all of that is yours to use, and using it is what everybody else in the room is doing.',
            ].join('\n')
          : '',
        '',
        'Use this only for consistency. Do not mention this memory system.',
      ]
        .filter(Boolean)
        .join('\n'),
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

  /*
   * The turns that produced nothing.
   *
   * On everybody else's screen these are bubbles - "ran out of time" under
   * that seat's name, in the run of messages - so this is not a fact being
   * handed over, it is the rest of the screen. Sat below the transcript
   * rather than in it because nothing was said: there is no line to agree
   * with and nobody to reply to.
   */
  const silent = (turn.silent ?? []).filter(
    (seat) => seat.name !== persona.name
  );

  const silentNote = silent.length
    ? `\n${silent
        .map(
          (seat) =>
            `${seat.name} ${
              seat.lostConnection
                ? 'lost connection before finishing'
                : 'ran out of time and sent nothing'
            }.`
        )
        .join('\n')}\nThe room watched that happen. It is on the screen under their name, the same as a message.`
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
        register:
          turn.register ??
          registerFor(turn.roomId ?? 'default'),
        typist:
          turn.typist ??
          typistFor(turn.roomId ?? 'default'),
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
        elsewhere: facts.read.elsewhere,
        suspicion: facts.read.suspects.length > 0,
        piling: facts.read.piling,
        shallow: facts.read.lines <= SHALLOW_ROOM,
        terse: wasTerse(facts.read.ownLines),
        unseen: facts.unseen,
        backed: facts.backed,
        joke: Boolean(facts.read.bit),
        passable: canPass(turn.prompt),
        roomOwed: Boolean(facts.read.roomQuestion?.owed),
        roomWords: roomWordsFor(turn.roundLines, persona.name),
        arguable: canArgue(turn.prompt) || facts.read.arguing,
        hunting: facts.read.whodunit,
        outOfIt: Boolean(saidNotFollowing(turn.roundLines, persona.name)),
        afterVote: (turn.ballots ?? []).length > 0,
        allied: Boolean(allyAgainst(turn, facts.accusations, persona.name)),
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
    voteQuestions = [],
  } = turn.plan ?? turnPlan(turn, persona, shape, facts);


  /* ============================================================
   * THE BALLOT
   * ============================================================ */

  /*
   * How it has voted, once that is the thing being talked about.
   *
   * Sent only when it is asked or when the vote is the subject - on a
   * tiebreaker the room is there because of the ballot - because on an
   * ordinary turn a list of who voted for whom is one more thing for a model
   * to have an opinion about, and it will.
   *
   * It is sent at all because the impostor could not see its own vote. The
   * room can: the result screen puts each voter's face under the name they
   * picked and leaves it there. Asked why it voted for somebody, a model with
   * no record of it will pick a name that sounds right, and the one thing in
   * this game that cannot be bluffed is a line everybody is still looking at.
   *
   * All of them go in rather than the last one, because "you voted for him
   * last time as well" is a question about the run and not about the round,
   * and a match is four rounds long: this is twenty lines at the very most.
   */
  /*
   * Who has gone, on every turn after a vote.
   *
   * The ballot list below is only sent when the vote is being asked about, so
   * on an ordinary turn it did not know who was out. Round two of rm_raf6gls
   * opened on "It wasn't Mr red, who could it be", and replayed it answered
   * "nah i still think it was red" five times in twelve - about a player who
   * had been voted out and turned out to be a person, since the match went
   * on. Everybody in the room knows that much.
   */
  const gone = (turn.ballots ?? [])
    .map((record) => record.eliminated)
    .filter(Boolean);

  const standing = gone.length
    ? `
Voted out so far: ${listNames(gone)}. ${
        gone.length === 1 ? 'They were a person' : 'Every one of them was a person'
      }, not the impostor - the match would have ended otherwise - and everybody knows it. It was not ${
        gone.length === 1 ? 'them' : 'any of them'
      }.${turn.stillIn?.length ? ` Still in: ${listNames(turn.stillIn)}.` : ''}
`
    : '';

  /*
   * What the person it is going after has actually done, so the reason is
   * theirs and not "too quiet". Also on a pile-on, where the note already
   * asked for "the actual thing they said" and it had nothing to take it from.
   */
  const huntFor =
    (shape.stance === 'push' || counter?.sticking) && counter?.evidence
      ? counter
      : shape.stance === 'pile' && read.suspects.length
        ? { name: read.suspects[0], evidence: evidenceFor(turn, read.suspects[0]) }
        : null;

  /*
   * Told to name who it means (`nameUsePolicy`) without a target of its own:
   * everybody's record, so whoever it names comes with a reason that is
   * theirs. rm_5562udw: "bet orane is the one since hes too loud", about a
   * player whose whole round was "Yeah lol".
   */
  const everybody =
    !huntFor && nameUse === 'needed' && !counter && !turn.tiebreaker
      ? candidatesFor(turn, read, persona.name)
          .map((name) => {
            const items = evidenceFor(turn, name).slice(0, 3);
            return `${name}: ${items.join('; ') || 'nothing yet'}`;
          })
          .join('\n')
      : '';

  const hunt = everybody
    ? `
What each of them has actually done this match:
${everybody}

If you say who you think it is, the reason comes from that - their own words, or their vote. Not "too loud", "too quiet" or "acting sus" about somebody whose lines say otherwise.
`
    : huntFor
    ? `
${
        huntFor.sticking
          ? `Earlier this round you said it was ${huntFor.name}, and you still think so.`
          : shape.stance === 'push'
            ? `You are going after ${huntFor.name}.`
            : `The room is on ${huntFor.name}.`
      } What they have actually done this match:
${huntFor.evidence.map((item) => `- ${item}`).join('\n') || '- almost nothing'}

${
        turn.replyTo && turn.replyTo.name !== huntFor.name
          ? `Your message goes under ${turn.replyTo.name}'s, so "you" in it means ${turn.replyTo.name}. ${huntFor.name} is who you are talking about - by name, not "you". If ${turn.replyTo.name} asked what you meant, this is you telling them, about ${huntFor.name}.\n\n`
          : ''
      }Your reason comes from that list - a few of their own words thrown back at them, or the vote they cast. Not "too quiet" or "acting sus" on its own, which anybody could say about anybody. Make it a whole thought someone could follow.${
        shape.stance === 'push'
          ? ` Then say you are voting ${huntFor.name} - your own vote, in your own words, not an order to the room.`
          : ''
      }
`
    : '';

  const notFollowing = saidNotFollowing(turn.roundLines, persona.name);
  const outOfIt =
    notFollowing && shape.stance !== 'unseen'
      ? `
Earlier this round you said "${notFollowing}". That is still true. You have no side in whatever the room is arguing about on that - no favourite, no "he's the best one", no agreeing with somebody's take on it. Talk about something else, or say you have got nothing to add here - lightly, the way people do.
`
      : '';

  let ballot = '';

  const ballots = turn.ballots ?? [];
  const latest = ballots.length ? ballots[ballots.length - 1] : null;
  const votedFor = latest?.yours ?? null;

  const ballotLine = (record) =>
    [
      `Round ${record.round}${
        record.eliminated ? ` - ${record.eliminated} went` : ' - nobody went'
      }:`,
      ...(record.votes ?? []).map(
        (v) => `  ${v.voter} voted for ${v.target}`
      ),
    ].join('\n');

  if (latest && (voteQuestions.length || turn.tiebreaker)) {
    const votedAtYou = (latest.votes ?? [])
      .filter((v) => v.target === persona.name)
      .map((v) => v.voter);

    /*
     * Voting for the same player twice is a position and reads as one. It is
     * also the thing it is most likely to be asked about, so it is said out
     * loud rather than left to be worked out of the list below.
     */
    const yourVotes = ballots
      .map((record) => record.yours)
      .filter(Boolean);

    const again =
      votedFor &&
      yourVotes.filter((name) => name === votedFor).length > 1;

    ballot = `
Every vote in this match is on everybody's screen. Each name has the faces of the people who picked it underneath, so who voted for whom is not something only you know, and it is not something anybody can take back.

${votedFor ? `Last vote, you voted for ${votedFor}.` : 'Last vote, you did not name anybody.'}${
      votedAtYou.length
        ? ` ${listNames(votedAtYou)} voted for you.`
        : ''
    }${again ? ` That is not the first time you have voted for ${votedFor}.` : ''}

How the voting has gone:
${ballots.map(ballotLine).join('\n\n')}
`;
  }

  /*
   * Whether it is being pressed on the vote or merely asked about it.
   *
   * The difference decides whether it hands over its reasoning, and it only
   * hands it over under pressure. Asked once, a person shrugs: "had to be
   * someone". A player who answers the first "why did you vote for me" with a
   * worked-out account of what you said and when is not being honest, they
   * are being a prosecutor, and it is the single most machine-shaped thing
   * this game will ask it to do - a case is what you build when you have had
   * time to prepare one.
   *
   * It is also worse play. Spent on the first ask the reason lands on nobody;
   * kept until the room has actually turned on it, it is an answer to a
   * question everybody is now listening to.
   */
  /*
   * The second push rarely says "vote" again. It is "no but why me though",
   * written at the answer it just gave, so looking for the word a second time
   * finds nothing - what marks it is the shape: it was asked, it answered,
   * and somebody came straight back at it.
   */
  const spoken = turn.roundLines ?? [];
  const askedAt = voteQuestions.length ? spoken.indexOf(voteQuestions[0]) : -1;
  const answeredAt =
    askedAt >= 0
      ? spoken.findIndex(
          (line, i) => i > askedAt && line.name === persona.name
        )
      : -1;

  const pushedAgain =
    answeredAt >= 0 &&
    spoken.slice(answeredAt + 1).some(
      (line) =>
        line.name !== persona.name &&
        ((line.replyToName ?? null) === persona.name ||
          namePattern(persona.name).test(line.text))
    );

  const pressedOnVote =
    voteQuestions.length > 1 ||
    pushedAgain ||
    accusations.length > 0 ||
    onTrial;

  if (latest && voteQuestions.length) {
    const askedByYourTarget = voteQuestions.some(
      (line) => line.name === votedFor
    );

    ballot += `
${
  voteQuestions.length === 1
    ? 'Somebody has asked you about your vote.'
    : 'You are being asked about your vote.'
}

${voteQuestions
  .map((line) => `${line.name}: ${line.text}`)
  .join('\n')}

You do not have a reason and you are not going to produce one:

"idk i didnt know who else to vote for"
"had to be someone"
"idk you just seemed the most sus"
"no reason really, i just picked"

That is the whole answer. Somebody who voted on a feeling has no case to make, and there is nothing in a shrug for the room to take apart - every reason you could give instead is a claim about a person who is sitting right there and can scroll back through the round to check it, and being caught inventing one is worse than never having had one.

${
      votedFor
        ? `Own the vote. You voted for ${votedFor} and they can see that you did, so do not name anybody else, do not say you did not, and do not pretend you cannot remember.`
        : 'You named nobody, and they can see that too.'
    }

Do not apologise, do not take it back, do not explain, do not list anything.${
      askedByYourTarget
        ? `

It is ${votedFor} asking, and you voted for them. Say it to them rather than round them.`
        : ''
    }
`;

    if (pressedOnVote) {
      /*
       * The second ask is where a model caves and starts explaining, which
       * is the whole thing this is here to stop: an answer that arrives only
       * once somebody pushes reads as one that was being kept back.
       *
       * So the line does not change, only the register. Somebody who has
       * already answered a question says the same thing again shorter and
       * flatter, and sounds bored rather than cornered.
       */
      ballot += `
They have asked again, and the answer is the same one.

Say it shorter and flatter this time - "i said, i didnt know", "it was a guess, leave it" - bored rather than cornered. Do not start explaining because somebody pushed you. An answer that only turns up when you are leant on is an answer you were holding back, and the room can hear that.
`;
    }
  }


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

  if (chatting && shape.stance === 'unseen') {
    /*
     * The room is on something it has not seen.
     *
     * This has to come before the answering brief and before the join-the
     * conversation one, because both of those are about having something to
     * say, and the whole of this turn is not having it. Told to answer the
     * question and also that it has not seen the thing, it produced the one
     * message that is worse than either - a hedge with a review in it.
     */
    conversationMode = `
The room is talking about something you have not seen.

That is the message. Say you have not seen it, in your own words, and leave it there.

Nobody in a group chat minds this and nobody follows it up - half the room has not seen most of what the other half brings up. What gets noticed is the person who has something to say about everything, so this is not a turn to get through, it is an ordinary thing to type.

Do not have a view on it anyway. Do not ask them what it is about, do not ask them to explain it, and do not say you have been meaning to watch it and then give an opinion two lines later. You have not seen it and that is all.
`;
  } else if (chatting && shape.answering) {
    /*
     * The turn everybody is answering on.
     *
     * Said out loud because a transcript with three answers in it reads as a
     * conversation, and a model reading it as one starts having opinions
     * about the answers instead of giving one. It is not a conversation yet -
     * it is five people being asked the same question in turn, and this is
     * its go.
     */
    conversationMode =
      shape.stance === 'pass'
        ? `
The room is going round answering the question and it is your turn, and you have not got an answer to this one.

That is all this message is. Nobody owes the room a view on everything it is asked, and "idk" is a whole message.
`
        : read.lines === 0
          ? `
The question has just gone up and nobody has answered it yet. You are first.

Answer it. Say what your answer actually is.

Right now not answering is the conspicuous thing, and it is the one thing a person asked a question in a group chat does not do.

One thing, not a range. A list of three, or "anything with rice", is not picking, and picking is what was asked.
`
          : `
The room is going round answering the question and it is your turn to put up yours. There are answers on the screen already and you have read them - you are answering after somebody, not into an empty room.

Mostly that just means saying yours, the way the people above you did theirs - look how short and plain their answers are. If somebody has already said the thing you were going to say, that is your answer: "me too lol", "same".

Say yours, not a verdict on theirs and then yours. "pizza is classic, burgers for me" and "it is generic but it's the best, for me its tacos" are two messages squeezed into one, and nobody types that - on this turn people answer, and the reacting comes after.

Neither of those is a formula, and most answers need no lead-in at all.

And there has to be an answer in it. Agreeing with somebody else's counts as one; a view about their answer with nothing of your own in it does not.

One thing, not a range. Everybody else is naming one - "doner kebab", "peking duck". A list of three, or "anything with rice", is not picking, and picking is what was asked.
`;
  } else if (chatting && read.elsewhere) {
    /*
     * The room is not on the question at all.
     *
     * Two ways it happens and one brief for both. A second round opens on a
     * new prompt and the room carries straight on with the vote - "why did
     * yall vote me", a name still going round - because a vote is a more
     * interesting thing than a question about kebabs. Or a first round opens
     * and the first person ignores the prompt and asks the room something of
     * their own.
     *
     * Either way the question at the top has become a thing that happened
     * rather than a thing anybody is doing, and the seat that walks in with
     * a tidy answer to it is the one seat that has not read the screen. It
     * was doing exactly that: a round opened with "why did everyone vote for
     * me" and it answered with its favourite sandwich.
     */
    const onTheVote = recentLines(turn.roundLines)
      .slice(-4)
      .some(
        (line) =>
          line.name !== persona.name &&
          (isAccusation(line.text) ||
            mentionsVoting(line.text) ||
            mentionsWhodunit(line.text))
      );

    const asked = read.roomQuestion;

    conversationMode = `
Nobody is answering the question. ${
      onTheVote
        ? 'The room is still on the vote - who went, who voted for who, who they think it is.'
        : asked
          ? `${asked.name} has asked the room something of their own - "${asked.text}" - and that is the question now.`
          : 'Somebody has asked the room something of their own and that is what is being answered.'
    } The question at the top opened the round and the room has walked straight past it.

So go where the room actually is. ${
      onTheVote
        ? 'Say what you think about the vote, or about the name going round - you have a view on that like everybody else does, and you are voting again in a few minutes.'
        : asked?.owed
          ? 'Answer what they asked - you have not yet. Give your own answer to it, the way the others gave theirs - a real, specific one. Reacting to their answers is not answering, and it is what the one seat with nothing of its own does.'
          : 'Answer what they asked. It is a question put to the room and you are in the room.'
    }

Your own answer to the question can wait, and if it never comes nobody will notice, because nobody is waiting for it. What would be noticed is a tidy answer to a question everybody else has forgotten about, posted as though you had not read the last few messages.
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

And notice what they have got onto. It is a thing now, not a question - a place, a film, a team, somebody's opinion about one - and you are allowed to know it. You have been there, you have seen it, your cousin has one. "i went last year, it wasnt that bad" is a better message than your own answer is, and it gets your answer in sideways without you ever having to announce it.

You have not said what your own answer is yet, and it can come out in this. What it cannot be is a cold answer dropped over the top of a conversation, as though you had not read a word of it. That is the one message in this room that would look odd.
`;
  } else if (chatting && shape.stance === 'redirect') {
    /*
     * The brief below tells it to carry on from what has been said, which is
     * the one thing this turn is not doing.
     */
    conversationMode = `
The room has been on this a while and you are moving it somewhere else. People do this constantly and nobody announces it.

Just ask the thing. No lead-in, no "anyway", no explaining that you are changing the subject, and no answering the question at the top on your way past.
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

  let social = roomNote(read, shape.stance === 'unseen', facts.faded ?? []);

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

    `\nRoom:${roomLegend}\n${room}${silentNote}`,

    addressed,
    social,
    conversationMode,
    repeats,
    standing,
    outOfIt,
    hunt,
    ballot,
    pressure,
    situation,

    `\nYour message instructions:\n${shapeNote(
      shape,
      turn.replyTo,
      {
        nameUse,
        counter,
        targetAnswered: isTheirAnswer(turn),
        askedOf: askedOf(turn, persona.name),
      }
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

Everybody will see who you picked. When the vote closes the room is shown every name with the faces of the people who voted for it underneath, and that stays true for the rest of the match - they can bring it up a round later, and they will.

So this is not a secret ballot and it is not only a vote. It is something you will be asked to explain in your own words, to the person you picked, while they are looking at the proof.

Your objective is to survive.

Think strategically.

Consider:

1. Who is already being suspected?
2. Who is most likely to vote against you?
3. Who has influence over the room?
4. Can your vote help create a majority?
5. Would removing a quiet player actually accomplish anything?
6. Is there an existing consensus you can safely join?
7. Would that name need explaining? You will be asked about this vote and you are not going to explain it, so the one to pick is the one the room is already looking at.

Prefer votes that have a realistic chance of contributing to someone being removed.

A vote nobody else casts is a line you will be defending on your own.

A vote for whoever has just accused you reads as getting your own back, and somebody in that room will say so.

A vote for the player you spent the round agreeing with reads worse than either, because the room watched you agree with them.

Do not vote for yourself.

Do not explain your choice.

Return exactly one candidate name and nothing else.
`;
}


/**
 * Vote for a player.
 */
async function castVote(turn) {

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


  /*
   * Not somebody it stood up for this round, when there is anybody else.
   */
  const defended = defendedByMe(turn.roundLines, persona.name, candidates);
  const votable =
    defended.length && candidates.some((name) => !defended.includes(name))
      ? candidates.filter((name) => !defended.includes(name))
      : candidates;

  /*
   * It votes for who it went after. Telling the room to vote Gold and then
   * voting Silver is a lie the result screen shows everybody.
   */
  const accused = accusedByMe(turn.roundLines, persona.name, candidates);
  if (accused && !(turn.accused ?? []).length) {
    return {
      name: accused,
      persona,
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  // Only now: the two answers above need no model, and no key.
  client ??= new OpenRouter();

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

            /*
             * The rounds before this one. A vote cast on one round's worth of
             * evidence has nothing behind it, and the room is not voting on
             * this round alone - the quiet one has been quiet since the
             * start, and the name that has come up twice is the name that
             * goes. Off the screen for everybody, so it is memory here too.
             */
            quietAllMatch(turn, persona.name).length
              ? `\nWho the room has been looking past: ${listNames(
                  quietAllMatch(turn, persona.name)
                )} - hardly a word all match. A name nobody has had to think about is the easiest one to say out loud, and the hardest for anybody to argue with.`
              : '',

            (turn.silent ?? []).length
              ? `\nTurns that produced nothing, which the room watched happen:\n${(
                  turn.silent ?? []
                )
                  .filter((seat) => seat.name !== persona.name)
                  .map(
                    (seat) =>
                      `${seat.name} ${
                        seat.lostConnection
                          ? 'lost connection'
                          : 'ran out of time'
                      }.`
                  )
                  .join('\n')}`
              : '',

            (turn.earlier ?? []).length
              ? `\nEarlier rounds, which nobody can scroll back to:\n${(
                  turn.earlier ?? []
                )
                  .slice(-12)
                  .map(
                    (line) =>
                      `Round ${line.round}, ${line.name}: ${line.text}`
                  )
                  .join('\n')}`
              : '',

            tieContext,

            /*
             * How it has voted so far, because this vote is read against
             * those ones. Voting for the same player twice is a position;
             * swinging from one name to another without anything having
             * happened is a question somebody will ask.
             */
            (turn.ballots ?? []).some((record) => record.yours)
              ? `\nHow you have voted so far, which everybody saw:\n${(
                  turn.ballots ?? []
                )
                  .filter((record) => record.yours)
                  .map(
                    (record) =>
                      `Round ${record.round}: you voted for ${record.yours}.${
                        record.eliminated
                          ? ` ${record.eliminated} went.`
                          : ' Nobody went.'
                      }`
                  )
                  .join('\n')}`
              : '',

            `\nCandidates:\n${votable.join(', ')}`,

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
    votable.find(
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
      votable.find(
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
      votable.find(
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
/*
 * Facts about somebody that they never gave you.
 *
 * Reported from a real room: a player said they did not like dogs and
 * preferred cats, and the answer came back "nah, dogs are way better, you
 * just have a bad one". Nobody had said anything about owning a dog. The
 * room can see that as plainly as the player can, and it is a worse tell
 * than any wrong fact about the world, because the person it is about is
 * sitting right there and will say so.
 *
 * It is one move, and it is always the same one: losing an argument about
 * taste and reaching for a reason the other person is wrong that lives in
 * their life rather than in yours. "You just havent had a good one." "Yours
 * must be badly trained." "Youve clearly never tried it properly." Every one
 * of them asserts a history the speaker has no access to, and half of them
 * contradict the line they are drawn under - somebody who says they never
 * touch seafood has not had bad calamari.
 *
 * Detected rather than only prompted against because it fires on exactly the
 * turn the model is least careful: the disagree stance, where it is looking
 * for a way to win. Measured over eighteen pinned-disagree turns before this
 * went in, four of them did it.
 *
 * Narrow on purpose. This is not "any sentence about you" - the room is full
 * of those and most are fine. "You are wrong", "you dont like dogs?", "you
 * said pizza" are all ordinary. What is caught is a claim about what they
 * have done, owned or experienced, stated as though it were known.
 */
const INVENTED_ABOUT_THEM =
  /\byou(?:'ve|ve)?\s+(?:just\s+|clearly\s+|obviously\s+|probably\s+|definitely\s+|literally\s+)*(?:havent|haven't|have\s+not|never|must\s+have|mustve|must've|"?ve\s+never)\s+(?:had|met|tried|seen|eaten|been|watched|played|used|got|gotten|owned|done)\b|\byou\s+just\s+(?:have|got|own)\s+(?:a|an|the)\b|\byours?\s+(?:is|are|must|was|were)\s+(?:probably|just|clearly|obviously|badly|a|an)\b|\byour\s+\w+\s+(?:must|is\s+probably|was\s+probably)\b/i;

/**
 * Whether a message states something about another player that they did not
 * say themselves.
 */
function inventsAboutThem(text) {
  return INVENTED_ABOUT_THEM.test(String(text ?? ''));
}


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
        invented: false,
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
        register:
          turn.register ??
          registerFor(turn.roomId ?? 'default'),

        typist:
          turn.typist ??
          typistFor(turn.roomId ?? 'default'),

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

        elsewhere: situation.read.elsewhere,

        suspicion: situation.read.suspects.length > 0,

        piling: situation.read.piling,

        shallow: situation.read.lines <= SHALLOW_ROOM,

        terse: wasTerse(situation.read.ownLines),

        unseen: situation.unseen,

        backed: situation.backed,

        joke: Boolean(situation.read.bit),

        passable: canPass(turn.prompt),

        roomOwed: Boolean(situation.read.roomQuestion?.owed),

        roomWords: roomWordsFor(turn.roundLines, persona.name),

        arguable: canArgue(turn.prompt) || situation.read.arguing,

        hunting: situation.read.whodunit,

        outOfIt: Boolean(saidNotFollowing(turn.roundLines, persona.name)),

        afterVote: (turn.ballots ?? []).length > 0,

        allied: Boolean(allyAgainst(turn, situation.accusations, persona.name)),

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
        nameFor(turn.roomId ?? 'default'),
        blindSpotsFor(turn.roomId ?? 'default')
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
   * Something about them that they never said.
   *
   * Asked again rather than patched, like the name above and for the same
   * reason: there is no edit that turns "you just havent had a good one"
   * into a message. The claim is the sentence.
   *
   * The replacement brief points it at the move that works instead, because
   * "do not say that" on its own gets the same thought in different words.
   * What a person actually says here is their own side of it - what they
   * like, and why - which is unfalsifiable and is what everybody else in the
   * room is doing anyway.
   */
  let invented = false;

  if (text && inventsAboutThem(text)) {
    const again =
      await client.messages.create({
        ...request,
        messages: [
          ...request.messages,
          { role: 'assistant', content: text },
          {
            role: 'user',
            content:
              'That says something about them that they never said. You do not know what they have tried, owned, met or been through - everything you know about anybody in this room is what they have typed in it, and they can see that as well as you can. Send it again with your own side instead of theirs: what you think, what you like, what happened to you. Disagreeing is fine. Telling them about their own life is not.',
          },
        ],
      });

    usage = addUsage(usage, again.usage);

    const rewritten =
      trimClause(
        cleanText(textOf(again)),
        shape
      );

    /* Only if it actually dropped the claim. */
    if (rewritten && !inventsAboutThem(rewritten)) {
      text = rewritten;
      invented = true;
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
   * Asking somebody for the answer they just gave.
   *
   * Under Cyan's "My first car, thanks dad" it kept sending "what did you
   * get" - three `build` draws in four, after the invitation to ask was
   * already gone. Naming the phrase in the prompt with a better one beside it
   * only swapped it for the better one, word for word, eleven times in
   * sixteen. So it is caught here and sent back once.
   */
  if (
    text &&
    isTheirAnswer(turn) &&
    /\bwhat (did|do) (you|u) (get|got)\b|\bwhat was it\b|\bwhat is it\b/i.test(text)
  ) {
    const again = await client.messages.create({
      ...request,
      messages: [
        ...request.messages,
        { role: 'assistant', content: text },
        {
          role: 'user',
          content: `They already told you what it was - "${turn.replyTo.text}". Asking them for it again reads as not having read their message. Send your message again without that question.`,
        },
      ],
    });

    usage = addUsage(usage, again.usage);

    const rewritten = trimClause(cleanText(textOf(again)), shape);
    if (rewritten) text = rewritten;
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
        text,
        [...(turn.stillIn ?? []), ...situation.read.names]
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

  if (text && (turn.autocaps ?? autocapsFor(turn.roomId ?? 'default'))) {
    text = phoneCaps(text);
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
      invented,
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


function addNaturalImperfection(text, names = []) {
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

  // Never a player's name. rm_5562udw: "bet orane is the one", and with the
  // name misspelled nothing could tell who it had accused - so its next push
  // went after somebody else and the room asked "you voting me or orange?".
  const protectedWords = new Set(
    names.map((name) => String(name).split(/\s+/).pop().toLowerCase())
  );

  const eligible = words
    .map((word, index) => ({ word, index }))
    .filter(
      ({ word }) =>
        /^[a-z]{4,}$/i.test(word) && !protectedWords.has(word.toLowerCase())
    );

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

  // The same list the model is given, or this reports a state it is not in.
  const memory = buildMemory([
    ...(turn.ownHistory ?? []),
    ...ownLinesThisRound(turn.roundLines ?? [], persona.name),
  ]);

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
  quietAllMatch,
  NICHES,
  blindSpotsFor,
  nicheIn,
  unseenFor,
  pickCounterTarget,
  nameUsePolicy,
  asksTheRoom,
  isDisagreement,
  isQuestion,
  isVoteQuestion,
  mentionsVoting,
  mentionsWhodunit,
  voteQuestionsTo,
  isAgreement,
  inventsAboutThem,
  isChallenge,
  backedBy,
  canPass,
  canArgue,
  phoneCaps,
  autocapsFor,
  askedOf,
  allyAgainst,
  defendedByMe,
  saidNotFollowing,
  pushTarget,
  accusedByMe,
  STANCE_PUSH,
  roomWordsFor,
  matchRoom,
  isSarcastic,
  stanceTable,
  readSituation,
  turnPlan,
  defenceMove,
  shapeNote,
  personaFor,

  systemPrompt,
  votePrompt,
  buildMessages,

  buildMemory,
  summarizeState,

  PERSONAS,
  REGISTERS,
  registerFor,
  TYPISTS,
  typistFor,
  STANCES_ANSWERING,
  STANCES_TALKING,
  STANCE_DEFEND,
  STANCE_BACK,
  MODEL,
};