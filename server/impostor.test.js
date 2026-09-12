/**
 * What the impostor is *told to do*, as opposed to what it is told about.
 *
 * `src/game/impostor.test.ts` covers the facts the room hands over. This
 * covers the decisions taken on top of them here — the stance, the name rule,
 * the read of the room and what happens when it gets accused — because those
 * are the four things that were wrong in play, and a prompt change that
 * quietly undoes one of them should fail rather than be noticed a match later.
 *
 * Nothing here calls the API. Every function under test is pure.
 */

const {
  accusationsAgainst,
  answerShape,
  trimClause,
  addNaturalImperfection,
  nearlyTheSame,
  cleanText,
  isChallenge,
  isDisagreement,
  readSituation,
  stanceTable,
  buildMessages,
  coAccused,
  nameUsePolicy,
  readRoom,
  repliesTo,
  roomNote,
  shapeNote,
  pickCounterTarget,
  isKeymash,
  roomIsMashing,
  keyboardMash,
  BITS,
  bitFor,
  resolveBit,
  systemPrompt,
  swearBack,
  hasDegenerated,
} = require('./impostor');

const ROOM = [
  { name: 'Nedim', text: 'the office, british one' },
  { name: 'Emil', text: 'us version is better fight me' },
  { name: 'Kofi', text: 'nah' },
  { name: 'AI', text: 'british one is only 12 eps' },
  { name: 'Nedim', text: 'lol' },
];

const turn = (over = {}) => ({
  roomId: 'r1',
  name: 'AI',
  prompt: 'What are you watching?',
  answerSeconds: 40,
  turnNumber: 2,
  turnsEach: 3,
  tiebreaker: false,
  accused: false,
  replyTo: null,
  roundLines: ROOM,
  ownHistory: [],
  ...over,
});

const lastMessage = (over = {}, shape = undefined) => {
  const messages = buildMessages({
    ...turn(over),
    shape,
    persona: { name: 'AI', brief: 'x', traits: [] },
  });
  return messages[messages.length - 1].content;
};

/**
 * Quoting the room back at it.
 *
 * Once it is told to point at the words people actually used, most of its
 * sharper lines carry a quote — and the wrapping-quote strip was taking the
 * opening one off whatever it found, so the room was shown `incel alert" is
 * too mean for a bot`.
 */
describe('tidying up what it wrote', () => {
  // It quoted the room in typography — `"you have no evidence" reads real to
  // me` — and was voted out on that message. People repeat the words; they
  // do not punctuate them, and the app is already showing the quote.
  it('keeps the words and drops the quote marks', () => {
    expect(cleanText('"incel alert" is not a bot line')).toBe(
      'incel alert is not a bot line'
    );
    expect(cleanText('\u201cyou have no evidence\u201d reads real')).toBe(
      'you have no evidence reads real'
    );
  });

  it('still unwraps a message that is nothing but a quoted answer', () => {
    expect(cleanText('"pepperoni"')).toBe('pepperoni');
    expect(cleanText("'i dont know'")).toBe('i dont know');
  });

  it('leaves an apostrophe where it belongs', () => {
    expect(cleanText("thats mara's whole point")).toBe("thats mara's whole point");
  });
});

/**
 * "yeah exactly", and then "yeh exactly" four messages later, which between
 * them were its entire contribution to the round.
 */
describe('not saying the same nothing twice', () => {
  it('will not draw a one-word turn straight after one', () => {
    const bands = new Set(
      Array.from(
        { length: 500 },
        () => answerShape(true, { laterTurn: true, terse: true }).length
      )
    );
    expect(bands.has('one to three words')).toBe(false);
  });

  it('leaves the band alone when the last thing it sent had something in it', () => {
    const bands = new Set(
      Array.from(
        { length: 500 },
        () => answerShape(true, { laterTurn: true }).length
      )
    );
    expect(bands.has('one to three words')).toBe(true);
  });

  it('shows it what it has already sent this round', () => {
    const content = lastMessage({
      roundLines: [
        { name: 'Tomas', text: 'i think tomas is right here', replyToName: null },
        { name: 'AI', text: 'yeah exactly', replyToName: null },
        { name: 'Priya', text: 'why you so defensive of her', replyToName: null },
      ],
      turnNumber: 2,
    });
    expect(content).toContain('You have already sent this in this round');
    expect(content).toContain('- yeah exactly');
    expect(content).toContain('not the same move twice');
  });

  it('reads a one-character difference as the same message', () => {
    expect(nearlyTheSame('yeah exactly', 'yeh exactly')).toBe(true);
    expect(nearlyTheSame('yeah exactly', 'Yeah, exactly!')).toBe(true);
  });

  it('leaves a different short message alone', () => {
    expect(nearlyTheSame('yeah exactly', 'yeah fair')).toBe(false);
    expect(nearlyTheSame('the jog thing is fake', 'the jog thing sounds fake')).toBe(false);
  });

  it('says nothing about it on a turn it has not spoken in', () => {
    const content = lastMessage({
      roundLines: [{ name: 'Tomas', text: 'look at my phone', replyToName: null }],
      turnNumber: 2,
    });
    expect(content).not.toContain('You have already sent this in this round');
  });
});

/**
 * The four humans in a real round typed "sicence", "typ", "dosent" and
 * "icebregg". Every line the impostor sent was spelled perfectly.
 */
describe('typing like a thumb', () => {
  const slipped = (text, runs = 400) =>
    Array.from({ length: runs }, () => addNaturalImperfection(text)).filter(
      (out) => out !== text
    );

  it('mistypes a word sometimes, and leaves it alone the rest of the time', () => {
    const rate = slipped('essays are easier than reading').length / 400;
    expect(rate).toBeGreaterThan(0.3);
    expect(rate).toBeLessThan(0.8);
  });

  it('keeps the first letter, so a typo stays the same word', () => {
    for (const out of slipped('reading', 200)) {
      expect(out[0]).toBe('r');
      expect(out.length).toBeGreaterThan(4);
    }
  });

  it('leaves short words alone, where a slip reads as a different word', () => {
    expect(slipped('nah its ok', 200)).toEqual([]);
  });
});

/**
 * Everything after the first comma used to be cut off unless a clause had
 * been drawn, which was four turns in five — so "nah, thats not it" went out
 * as "nah", and every long line the room ever saw was comma-free by
 * construction. Nobody writes like that.
 */
describe('length, and the commas that go with it', () => {
  const draws = (over = {}, runs = 20000) =>
    Array.from({ length: runs }, () => answerShape(true, over));

  it('says something of some length about a third of the time', () => {
    const sample = draws();
    const long = sample.filter((shape) => shape.words[1] >= 8).length / sample.length;
    expect(long).toBeGreaterThan(0.3);
    expect(long).toBeLessThan(0.55);
  });

  it('still sends short ones, which is most of what a chat is', () => {
    const sample = draws();
    const short = sample.filter((shape) => shape.words[1] <= 7).length / sample.length;
    expect(short).toBeGreaterThan(0.45);
  });

  it('lets a comma through on a long message however the draw went', () => {
    expect(
      trimClause('you have no evidence against me, that makes me think its you', {
        clause: false,
        list: false,
        words: [8, 13],
      })
    ).toBe('you have no evidence against me, that makes me think its you');
  });

  it('still cuts the footnote off a three word message', () => {
    expect(
      trimClause('nah, its not that deep really', { clause: false, list: false, words: [1, 3] })
    ).toBe('nah');
  });

  it('reaches for a comma far more on a long message than a short one', () => {
    const rate = (words) =>
      draws({}, 40000).filter((shape) => shape.words[1] === words && shape.clause).length /
      Math.max(1, draws({}, 40000).filter((shape) => shape.words[1] === words).length);
    expect(rate(13)).toBeGreaterThan(rate(3) * 3);
  });
});

describe('being named', () => {
  it('does not read a question as an accusation', () => {
    const lines = [{ name: 'Nedim', text: 'ai what are you watching' }];
    expect(accusationsAgainst(lines, 'AI')).toHaveLength(0);
  });

  // The seat is called AI under the test harness, so the name would otherwise
  // trip the accusation markers every time it was used.
  it('still hears an accusation aimed at a player called AI', () => {
    const lines = [{ name: 'Nedim', text: 'AI is sus honestly' }];
    expect(accusationsAgainst(lines, 'AI')).toHaveLength(1);
  });

  it('leaves the impostor answering normally when it is only spoken to', () => {
    const content = lastMessage({
      roundLines: [{ name: 'Emil', text: 'ai did you watch it too' }],
    });
    expect(content).toContain('talking to you rather than accusing you');
    expect(content).not.toContain('accused you of being the AI');
  });
});

describe('names in its own messages', () => {
  it('never types a name into a reply, because the app already shows one', () => {
    const note = shapeNote(
      { length: 'four to seven words', words: [4, 7], stanceNote: null },
      { name: 'Emil', text: 'us version is better fight me' },
      { nameUse: 'avoid', counter: null }
    );
    expect(note).not.toContain('Emil');
    expect(note).toContain('do not type their name');
  });

  it('keeps the reply target out of the instructions entirely', () => {
    const content = lastMessage({
      replyTo: { name: 'Emil', text: 'us version is better fight me' },
    });
    const instructions = content.split('Your message instructions:')[1];
    expect(instructions).not.toContain('Emil');
  });

  it('avoids a name when it used one in its last line', () => {
    const read = readRoom(
      [...ROOM, { name: 'AI', text: 'kofi has a point tbh' }],
      'AI'
    );
    expect(
      nameUsePolicy({ replyTo: null, counter: null, read })
    ).toBe('avoid');
  });

  it('names the person it is turning on', () => {
    const read = readRoom(ROOM, 'AI');
    expect(
      nameUsePolicy({
        replyTo: { name: 'Emil', text: 'x' },
        counter: { name: 'Kofi', why: 'quiet' },
        read,
      })
    ).toBe('needed');
  });
});

describe('having a view of its own', () => {
  const stances = (over, runs = 600) =>
    Array.from({ length: runs }, () => answerShape(true, over).stance);

  const reactiveRate = (sample) =>
    sample.filter((stance) => stance === 'agree' || stance === 'disagree').length /
    sample.length;

  // Asked for a pizza topping with pineapple already on screen, it was
  // replying that pineapple is not a topping — a turn in which it never said
  // what it liked. The first time round the room is for answering.
  it('answers the question on the turn everybody is answering on', () => {
    const sample = stances({});
    expect(new Set(sample)).toEqual(new Set(['own', 'tangent']));
    expect(sample.filter((stance) => stance === 'own').length / sample.length)
      .toBeGreaterThan(0.8);
  });

  it('has views once it has answered, and is not shy about them', () => {
    const sample = stances({ laterTurn: true });
    expect(new Set(sample).size).toBe(5);
    // Not the default move, but not something it talks itself out of either.
    expect(reactiveRate(sample)).toBeGreaterThan(0.3);
    expect(reactiveRate(sample)).toBeLessThan(0.55);
  });

  it('does not spend most of a round rating somebody else', () => {
    // A round is one answering turn and two talking ones.
    const round = [
      ...stances({}, 400),
      ...stances({ laterTurn: true }, 400),
      ...stances({ laterTurn: true }, 400),
    ];
    expect(reactiveRate(round)).toBeLessThan(0.4);
  });

  it('cannot agree with a room that has not spoken', () => {
    const sample = new Set(
      Array.from({ length: 200 }, () => answerShape(false, { laterTurn: true }).stance)
    );
    expect(sample.has('agree')).toBe(false);
    expect(sample.has('build')).toBe(false);
  });

  // Two instructions drawn independently used to contradict each other:
  // "react to the room first" on top of "say something that owes nothing to
  // anybody else".
  it('never asks for a reaction and an unprompted thought at once', () => {
    for (let i = 0; i < 300; i++) {
      const shape = answerShape(true, { laterTurn: true });
      expect(shape.react && shape.stance === 'own').toBe(false);
    }
  });
});

describe('being accused', () => {
  const accused = { roundLines: [...ROOM, { name: 'Nedim', text: 'AI is sus, too fast' }] };

  it('is allowed to be rude about it', () => {
    const content = lastMessage(accused, {
      ...answerShape(true, { underPressure: true }),
      pushback: 'annoyed',
    });
    expect(content).toContain('allowed to sound irritated');
    expect(content).toContain('Do not be gracious about it');
  });

  it('drops the polite reply rules when it is pushing back', () => {
    const note = shapeNote(
      { length: 'eight to thirteen words', words: [8, 13], pushback: 'annoyed' },
      { name: 'Nedim', text: 'AI is sus, too fast' },
      { nameUse: 'avoid', counter: null }
    );
    expect(note).not.toContain('Do not accuse anybody');
  });

  it('keeps those rules on an ordinary reply', () => {
    const note = shapeNote(
      { length: 'eight to thirteen words', words: [8, 13], pushback: null },
      { name: 'Nedim', text: 'the office, british one' },
      { nameUse: 'avoid', counter: null }
    );
    expect(note).toContain('Do not accuse anybody');
  });

  it('turns it back on somebody rather than defending itself', () => {
    const content = lastMessage(accused, {
      ...answerShape(true, { underPressure: true }),
      pushback: 'counter',
    });
    expect(content).toContain('Do not spend this message defending yourself');
    expect(content).toMatch(/turn it around onto (Nedim|Emil|Kofi)/);
  });

  it('goes after the other name on the ballot when the vote has tied', () => {
    const read = readRoom(ROOM, 'AI');
    const target = pickCounterTarget(
      turn({
        tiebreaker: true,
        accused: true,
        prompt: 'It is between Kofi and AI. Say your piece before the vote.',
      }),
      read,
      [],
      'AI'
    );
    expect(target.name).toBe('Kofi');
  });

  it('reads the two names off the room\'s own wording', () => {
    expect(
      coAccused(
        'It is between Kofi and AI. Say your piece before the vote.',
        ['Nedim', 'Emil', 'Kofi'],
        'AI'
      )
    ).toEqual(['Kofi']);
  });

  it('does not also tell it to carry on chatting', () => {
    const content = lastMessage(accused);
    expect(content).not.toContain('This turn is the conversation after it');
  });

  it('says the defence once, not once per block', () => {
    const content = lastMessage(
      {
        ...accused,
        tiebreaker: true,
        accused: true,
        prompt: 'It is between Kofi and AI. Say your piece before the vote.',
      },
      { ...answerShape(true, { underPressure: true, tiebreaker: true, onTrial: true }), pushback: 'counter' }
    );
    const defences = content.split('Do not spend this message defending yourself').length - 1;
    expect(defences).toBe(1);
  });
});

describe('reading the room', () => {
  it('counts a joke as a joke', () => {
    const read = readRoom(
      [
        { name: 'Emil', text: 'lol' },
        { name: 'Kofi', text: 'lmao what' },
        { name: 'Nedim', text: 'haha stop' },
      ],
      'AI'
    );
    expect(read.joking).toBe(true);
    expect(roomNote(read)).toContain('gone light');
  });

  it('notices somebody else taking the heat', () => {
    const read = readRoom(
      [
        { name: 'Emil', text: 'kofi is being weird' },
        { name: 'Nedim', text: 'yeah kofi is sus' },
        { name: 'Kofi', text: 'what' },
      ],
      'AI'
    );
    expect(read.suspects).toEqual(['Kofi']);
    expect(roomNote(read)).toContain('not on you');
  });

  // One line each is not silence, and calling it silence pointed the impostor
  // at whoever happened to be listed first.
  it('does not call a room quiet when everybody has said one thing', () => {
    const read = readRoom(
      [
        { name: 'Emil', text: 'a' },
        { name: 'Kofi', text: 'b' },
        { name: 'Nedim', text: 'c' },
      ],
      'AI'
    );
    expect(read.quiet).toEqual([]);
  });

  it('finds the one who has sat out a real conversation', () => {
    const read = readRoom(
      [
        { name: 'Emil', text: 'a' },
        { name: 'Nedim', text: 'b' },
        { name: 'Emil', text: 'c' },
        { name: 'Nedim', text: 'd' },
        { name: 'Kofi', text: 'e' },
        { name: 'Emil', text: 'f' },
      ],
      'AI'
    );
    expect(read.quiet).toEqual(['Kofi']);
    expect(roomNote(read)).toContain('Kofi has hardly said anything');
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(roomNote(readRoom([], 'AI'))).toBe('');
  });
});

/**
 * The half of the room the transcript used to throw away: who wrote at whom,
 * and whether any of it was aimed at the impostor.
 */
describe('replies', () => {
  const THREAD = [
    { name: 'Nedim', text: 'the office, british one', replyToName: null },
    { name: 'Emil', text: 'us version is better', replyToName: null },
    { name: 'AI', text: 'british one is only 12 eps', replyToName: 'Emil' },
    { name: 'Emil', text: 'its true I watch the US one', replyToName: 'AI' },
    { name: 'Kofi', text: 'lol', replyToName: null },
  ];

  const inThread = (over = {}, shape = undefined) =>
    lastMessage({ roundLines: THREAD, ...over }, shape);

  it('finds the lines written at it', () => {
    expect(repliesTo(THREAD, 'AI').map((line) => line.text)).toEqual([
      'its true I watch the US one',
    ]);
  });

  it('does not count its own reply as somebody replying to it', () => {
    // Emil is the one who wrote last here, so from that seat the reply
    // aimed at him is already behind him.
    expect(repliesTo(THREAD, 'Emil')).toEqual([]);

    const beforeEmilAnswers = THREAD.slice(0, 3);
    expect(repliesTo(beforeEmilAnswers, 'Emil').map((line) => line.text)).toEqual([
      'british one is only 12 eps',
    ]);
  });

  // A question put to it stayed "unanswered" for the rest of the round, so
  // every turn after it was spent answering the same question again while the
  // room talked about something else.
  it('stops carrying a reply it has already answered', () => {
    const answered = [
      ...THREAD,
      { name: 'AI', text: 'the us one drags though', replyToName: 'Emil' },
      { name: 'Kofi', text: 'anyway what is everyone eating', replyToName: null },
    ];

    expect(repliesTo(answered, 'AI')).toEqual([]);
    expect(lastMessage({ roundLines: answered })).not.toContain(
      'wrote back at something you said'
    );
  });

  it('picks up a new one written at it after that', () => {
    const answeredThenAsked = [
      ...THREAD,
      { name: 'AI', text: 'the us one drags though', replyToName: 'Emil' },
      { name: 'Kofi', text: 'anyway what is everyone eating', replyToName: null },
      { name: 'Nedim', text: 'you never said which season', replyToName: 'AI' },
    ];

    expect(repliesTo(answeredThenAsked, 'AI').map((line) => line.text)).toEqual([
      'you never said which season',
    ]);
  });

  it('shows the room who each line was written at', () => {
    const content = inThread();
    expect(content).toContain('AI -> Emil: british one is only 12 eps');
    expect(content).toContain('Emil -> AI: its true I watch the US one');
    expect(content).toContain('"a -> b" is a reply');
  });

  it('leaves the arrows out of a round nobody has replied in', () => {
    const content = lastMessage();
    expect(content).not.toContain('->');
    expect(content).not.toContain('is a reply');
  });

  it('tells it when it has been written at', () => {
    const content = inThread();
    expect(content).toContain('wrote back at something you said');
    expect(content).toContain('its true I watch the US one');
  });

  // Being written at and then writing back is a thread, not a fresh reply,
  // and it should not read like the first thing said to a stranger.
  it('knows a back and forth from a cold reply', () => {
    const content = inThread({
      replyTo: { name: 'Emil', text: 'its true I watch the US one' },
    });
    expect(content).toContain('back and forth');
    expect(content).not.toContain('wrote back at something you said');
  });

  it('does not also point at the last message in the room', () => {
    expect(inThread()).not.toContain('Consider whether the last message');
  });

  it('does not point at one on the turn it is meant to be answering', () => {
    const content = lastMessage({ turnNumber: 1 });
    expect(content).not.toContain('the last message in the room');
    expect(content).toContain('it is your turn to put up yours');
  });

  it('says nothing about replies when nobody has written at it', () => {
    const content = lastMessage({
      roundLines: [{ name: 'Emil', text: 'us version', replyToName: 'Nedim' }],
    });
    expect(content).not.toContain('wrote back at something you said');
  });

  // "Say something that owes nothing to anybody else" and "answer the message
  // quoted above yours" were being drawn for the same turn.
  it('never asks a reply to owe nothing to the message it answers', () => {
    for (let i = 0; i < 300; i++) {
      expect(answerShape(true, { replying: true, laterTurn: true }).stance).not.toBe(
        'own'
      );
    }
  });

  // Replying is not a way out of answering: on the first time round the room
  // the message has to carry its own answer either way.
  it('makes a reply on the answering turn still give an answer', () => {
    const note = shapeNote(
      { length: 'four to seven words', words: [4, 7], answering: true },
      { name: 'Nedim', text: 'pineapple' },
      { nameUse: 'avoid', counter: null }
    );
    expect(note).toContain('has to contain it');

    const later = shapeNote(
      { length: 'four to seven words', words: [4, 7], answering: false },
      { name: 'Nedim', text: 'pineapple' },
      { nameUse: 'avoid', counter: null }
    );
    expect(later).not.toContain('has to contain it');
  });
});

describe('how often a name gets typed at all', () => {
  it('almost never, when nothing requires one', () => {
    const read = readRoom(ROOM, 'AI');
    const draws = Array.from({ length: 2000 }, () =>
      nameUsePolicy({ replyTo: null, counter: null, read })
    );
    expect(draws.filter((d) => d === 'allowed').length / draws.length).toBeLessThan(0.1);
  });
});

/**
 * Somebody coming at what it said, as opposed to somebody coming at it.
 */
describe('standing by what it said', () => {
  const persona = { name: 'AI', brief: 'x', traits: [] };

  const CHALLENGED = [
    { name: 'Nedim', text: 'pineapple', replyToName: null },
    { name: 'AI', text: 'pepperoni', replyToName: null },
    { name: 'Nedim', text: 'nah pepperoni is the boring answer', replyToName: 'AI' },
  ];

  it('knows a disagreement from an accusation', () => {
    expect(isDisagreement('nah pepperoni is the boring answer')).toBe(true);
    expect(isDisagreement('yeah same actually')).toBe(false);
  });

  it('counts somebody arguing with its answer as a challenge', () => {
    const { challenged } = readSituation({ roundLines: CHALLENGED }, persona);
    expect(challenged.map((line) => line.text)).toEqual([
      'nah pepperoni is the boring answer',
    ]);
  });

  // Being told your topping is boring is not being told you are a robot, and
  // answering the first as though it were the second is its own tell.
  it('does not read being accused as being disagreed with', () => {
    const accused = [
      { name: 'AI', text: 'pepperoni', replyToName: null },
      { name: 'Nedim', text: 'nah AI is the bot, too fast', replyToName: 'AI' },
    ];
    const { challenged, accusations } = readSituation({ roundLines: accused }, persona);
    expect(challenged).toEqual([]);
    expect(accusations).toHaveLength(1);
  });

  it('offers standing your ground only once somebody has come at you', () => {
    expect(stanceTable({ challenged: true }).map((o) => o.key)).toContain('defend');
    expect(stanceTable({}).map((o) => o.key)).not.toContain('defend');
  });

  it('makes it the likeliest thing to do when it happens', () => {
    const sample = Array.from(
      { length: 2000 },
      () => answerShape(true, { laterTurn: true, challenged: true }).stance
    );
    const rate = sample.filter((s) => s === 'defend').length / sample.length;
    expect(rate).toBeGreaterThan(0.35);
    // Not the only thing it can do — conceding is a move people make too.
    expect(rate).toBeLessThan(0.6);
  });

  it('tells it that the reply was not agreement', () => {
    const content = lastMessage({ roundLines: CHALLENGED, turnNumber: 2 });
    expect(content).toContain('they are not agreeing with you');
  });
});

/**
 * The question at the top starts a conversation. It does not run a roll call.
 *
 * A room where one answer gets picked up, argued with and answered back is no
 * longer going round the question, and the player who walks into that and
 * posts their own topping as though the last three messages had not happened
 * is the one everybody notices. So what the turn is for is read off the room
 * rather than off the turn number.
 */
describe('a room that has stopped answering the question', () => {
  const persona = { name: 'AI', brief: 'x', traits: [] };

  const ANSWERING = [
    { name: 'Nedim', text: 'pineapple', replyToName: null },
    { name: 'Emil', text: 'mushroom', replyToName: null },
    { name: 'Kofi', text: 'lol pineapple', replyToName: 'Nedim' },
  ];

  const ARGUING = [
    { name: 'Nedim', text: 'pineapple', replyToName: null },
    { name: 'Emil', text: 'pineapple on a pizza is a war crime', replyToName: 'Nedim' },
    { name: 'Nedim', text: 'its the sweet and salty thing, thats the point', replyToName: 'Emil' },
  ];

  it('knows a round still going round from a conversation', () => {
    expect(readRoom(ANSWERING, 'AI').talking).toBe(false);
    expect(readRoom(ARGUING, 'AI').talking).toBe(true);
  });

  // "nah" and "lol" turn up in answers as often as in arguments. Something
  // has to have actually been aimed at somebody.
  it('does not mistake a round with filler in it for one', () => {
    const filler = [
      { name: 'Nedim', text: 'the office', replyToName: null },
      { name: 'Emil', text: 'nah friends', replyToName: null },
      { name: 'Kofi', text: 'lol', replyToName: null },
    ];
    expect(readRoom(filler, 'AI').talking).toBe(false);
  });

  it('still owes an answer to a room that is still asking for one', () => {
    expect(answerShape(true, {}).answering).toBe(true);
    expect(answerShape(true, { talking: true }).answering).toBe(false);
  });

  it('joins in instead, and its answer comes out inside that', () => {
    const keys = stanceTable({ unanswered: true }).map((option) => option.key);
    expect(keys).toContain('own');
    expect(keys).toContain('disagree');
    // A tangent from the one person who never answered is the worst of both.
    expect(keys).not.toContain('tangent');

    const own = stanceTable({ unanswered: true }).find((o) => o.key === 'own');
    expect(own.note).toContain('have not said what your own answer');
  });

  it('is told to join the conversation rather than answer over it', () => {
    const content = lastMessage({ roundLines: ARGUING, turnNumber: 1 });
    expect(content).toContain('the room has stopped going round it');
    expect(content).not.toContain('it is your turn to put up yours');
  });

  it('still answers when the room is going round the question', () => {
    const content = lastMessage({ roundLines: ANSWERING, turnNumber: 1 });
    expect(content).toContain('it is your turn to put up yours');
  });

  // Missing a turn is not the same as having answered. It had said nothing
  // at all and was being told it had already answered earlier in the round.
  it('does not tell a player who never spoke that it already answered', () => {
    const content = lastMessage({ roundLines: ARGUING, turnNumber: 2 });
    expect(content).not.toContain('already answered the question earlier');
  });

  it('reads its own line as having answered', () => {
    const spoken = [...ARGUING, { name: 'AI', text: 'pepperoni', replyToName: null }];
    expect(readRoom(spoken, 'AI').spokenYet).toBe(true);
    expect(lastMessage({ roundLines: spoken, turnNumber: 2 })).toContain(
      'already answered the question earlier'
    );
  });
});

/**
 * The turn a name goes up.
 *
 * A real round: Priya said "Nadia is too rude I think she's the impostor",
 * Jonas said "I think so too", and the impostor - drawn `own`, and told only
 * that it did not need to defend itself - sent "rude is just how some people
 * type". A generalisation about typing, from the one seat in the room with a
 * stake in where the vote lands.
 */
describe('the room turning on somebody else', () => {
  const NAMED = [
    { name: 'Nadia', text: 'I dont believe you', replyToName: null },
    { name: 'Priya', text: "Nadia is too rude I think she's the impostor", replyToName: null },
    { name: 'Jonas', text: 'I think so too', replyToName: null },
  ];

  it('sees who is in the frame', () => {
    expect(readRoom(NAMED, 'AI').suspects).toEqual(['Nadia']);
  });

  it('gives it something to do about it', () => {
    const keys = stanceTable({ suspicion: true }).map((option) => option.key);
    expect(keys).toContain('pile');
    expect(keys).toContain('doubt');
    // Wandering off the accusation is what somebody not following the room does.
    expect(keys).not.toContain('tangent');
    expect(keys).not.toContain('build');
  });

  it('leaves both of them off a room that has named nobody', () => {
    const keys = stanceTable({}).map((option) => option.key);
    expect(keys).not.toContain('pile');
    expect(keys).not.toContain('doubt');
  });

  // It lost a match on exactly this: two people had put Nedim's name up, it
  // spent both remaining turns on his side, and the two accusing him voted
  // for it instead.
  it('knows one persons theory from a room that has converged', () => {
    const oneVoice = [
      { name: 'Tomas', text: 'you are really sus man', replyToName: 'Nedim' },
      { name: 'Tomas', text: 'still sus', replyToName: null },
    ];
    expect(readRoom(oneVoice, 'AI').piling).toBe(false);
    expect(readRoom(NAMED, 'AI').piling).toBe(false);

    const converged = [
      { name: 'Nedim', text: 'Kofi wasnt an impostor what are you talking about', replyToName: null },
      { name: 'Tomas', text: 'you are really sus man', replyToName: 'Nedim' },
      { name: 'Priya', text: 'Its you Nedim admit it', replyToName: null },
    ];
    expect(readRoom(converged, 'AI').piling).toBe(true);
  });

  it('rarely takes the side of a name the room has settled on', () => {
    const rate = (piling) =>
      Array.from(
        { length: 2000 },
        () => answerShape(true, { laterTurn: true, suspicion: true, piling }).stance
      ).filter((s) => s === 'doubt').length / 2000;

    expect(rate(false)).toBeGreaterThan(0.1);
    expect(rate(true)).toBeLessThan(0.09);
    // Never doing it at all would be its own pattern.
    expect(rate(true)).toBeGreaterThan(0.01);
  });

  it('makes having a view about it the likeliest thing, not the only thing', () => {
    const sample = Array.from(
      { length: 2000 },
      () => answerShape(true, { laterTurn: true, suspicion: true }).stance
    );
    const rate = (key) => sample.filter((s) => s === key).length / sample.length;
    expect(rate('pile') + rate('doubt')).toBeGreaterThan(0.35);
    expect(rate('pile') + rate('doubt')).toBeLessThan(0.6);
    // Backing every accusation would be its own pattern.
    expect(rate('doubt')).toBeGreaterThan(0.1);
  });

  it('tells it what the turn is for, not only what it is not', () => {
    const note = roomNote(readRoom(NAMED, 'AI'));
    expect(note).toContain('The room has turned on Nadia');
    expect(note).toContain('what you make of it is the thing worth saying');
  });
});

/**
 * If everybody is arguing, it argues.
 */
describe('a room mid-argument', () => {
  it('does not change the subject in the middle of one', () => {
    const keys = stanceTable({ argument: true }).map((option) => option.key);
    expect(keys).not.toContain('tangent');
    expect(keys).toContain('back');
  });

  it('makes having a view the likeliest thing in the room', () => {
    const sample = Array.from(
      { length: 2000 },
      () => answerShape(true, { laterTurn: true, argument: true }).stance
    );
    const rate = (key) => sample.filter((s) => s === key).length / sample.length;
    const engaged = rate('agree') + rate('disagree') + rate('back');
    expect(engaged).toBeGreaterThan(0.55);
    expect(rate('tangent')).toBe(0);
    // Still an argument it is in, not one it is only reporting on.
    expect(rate('disagree')).toBeGreaterThan(rate('agree'));
  });

  it('tells it to get into it rather than watch it', () => {
    const note = roomNote(readRoom(
      [
        { name: 'Nedim', text: 'nah thats wrong', replyToName: 'Emil' },
        { name: 'Emil', text: 'no it isnt, but ok', replyToName: 'Nedim' },
      ],
      'AI'
    ));
    expect(note).toContain('Get into it');
    expect(note).not.toContain('stay out of it');
  });
});

describe('taking somebody else\'s side', () => {
  it('is only on the table when there is an argument to take a side in', () => {
    expect(stanceTable({ argument: true }).map((o) => o.key)).toContain('back');
    expect(stanceTable({}).map((o) => o.key)).not.toContain('back');
  });

  it('is a minority move, not a habit', () => {
    const sample = Array.from(
      { length: 2000 },
      () => answerShape(true, { laterTurn: true, argument: true }).stance
    );
    const rate = sample.filter((s) => s === 'back').length / sample.length;
    expect(rate).toBeGreaterThan(0.1);
    expect(rate).toBeLessThan(0.3);
  });

  it('is never offered on the turn it still owes an answer', () => {
    const keys = stanceTable({ answering: true, challenged: true, argument: true }).map(
      (o) => o.key
    );
    expect(keys).toEqual(['own', 'tangent']);
  });
});

/**
 * Four things a real round exposed, all of which cost it that round.
 */
describe('reading a message aimed at it', () => {
  const persona = { name: 'AI', brief: 'x', traits: [] };

  // It answered "past lives", was asked what that was, and defended the
  // choice instead of saying what the film was. The room said "Ok..." and
  // voted it out.
  it('does not read being asked a question as being argued with', () => {
    expect(isChallenge('What movie is that? Never heard of it')).toBe(false);
    const { challenged } = readSituation(
      {
        roundLines: [
          { name: 'AI', text: 'past lives', replyToName: null },
          { name: 'Ayla', text: 'What movie is that? Never heard of it', replyToName: 'AI' },
        ],
      },
      persona
    );
    expect(challenged).toEqual([]);
  });

  // The commonest disagreement in a chat has no negative word in it, which is
  // why this is decided by elimination rather than by a word list.
  it('reads a flat contradiction as pushback even with no objection words in it', () => {
    expect(isChallenge('Marvel is way better')).toBe(true);
    const { challenged } = readSituation(
      {
        roundLines: [
          { name: 'AI', text: 'dc for me', replyToName: null },
          { name: 'Ayla', text: 'Marvel is way better', replyToName: 'AI' },
        ],
      },
      persona
    );
    expect(challenged).toHaveLength(1);
  });

  it('leaves agreement alone, and hears an objection that opens with yeah', () => {
    expect(isChallenge('yeah same')).toBe(false);
    expect(isChallenge('yeah but thats not right')).toBe(true);
  });

  it('still keeps an accusation on its own track', () => {
    expect(isChallenge('AI is sus')).toBe(false);
  });
});

describe('who it can turn on', () => {
  const read = readRoom(
    [
      { name: 'Ines', text: 'films are for kids', replyToName: null },
      { name: 'Priya', text: 'a', replyToName: null },
      { name: 'Priya', text: 'b', replyToName: null },
      { name: 'Ayla', text: 'c', replyToName: null },
      { name: 'Ayla', text: 'd', replyToName: null },
      { name: 'Nedim', text: 'AI is sus', replyToName: null },
    ],
    'AI'
  );

  // It turned on a player who had walked out two messages earlier, twice, and
  // the room answered "ines is not here, that only leaves you".
  it('never points at somebody who has left the room', () => {
    const turn = {
      tiebreaker: false,
      accused: false,
      prompt: 'p',
      stillIn: ['Priya', 'Ayla', 'Nedim', 'AI'],
    };
    const picked = Array.from({ length: 400 }, () =>
      pickCounterTarget(turn, read, [{ name: 'Ines', text: 'AI is the bot' }], 'AI')
    );
    expect(picked.every((p) => p !== null && p.name !== 'Ines')).toBe(true);
  });

  it('falls back to the whole room when nobody said who is still in', () => {
    const turn = { tiebreaker: false, accused: false, prompt: 'p' };
    const picked = pickCounterTarget(
      turn,
      read,
      [{ name: 'Ines', text: 'AI is the bot' }],
      'AI'
    );
    expect(picked).not.toBeNull();
  });
});

describe('under sustained accusation', () => {
  it('is shown what it has already said, so it stops saying it again', () => {
    const content = lastMessage({
      turnNumber: 3,
      roundLines: [
        { name: 'AI', text: 'dc for me', replyToName: null },
        { name: 'Nedim', text: 'Idk AI I think its you', replyToName: null },
        { name: 'AI', text: 'nah. ines said "thats for kids" and left', replyToName: null },
        { name: 'Priya', text: 'that only leaves you AI', replyToName: null },
      ],
    });
    expect(content).toContain('You have already said this much in this round');
    expect(content).toContain('- dc for me');
    expect(content).toContain('Do not make a point you have already made');
  });
});

describe('when the room stops typing words', () => {
  const mash = (text) => ({ name: 'Nedim', text, replyToName: null });

  it('reads a hand on the keyboard as not words', () => {
    for (const line of [
      'asljkdhaslkjd',
      'sdkfjhsdkf',
      'asdasdasd',
      'lkjhgfdsa',
      'qwertyuiop',
      'fdsafdsafdsa',
    ]) {
      expect(isKeymash(line)).toBe(true);
    }
  });

  it('leaves noise people actually mean alone', () => {
    // Each of these has a sense to it, and answering one with a fistful of
    // consonants is a non sequitur rather than a match.
    for (const line of ['aaaaaa', 'hahahaha', 'hmmmm', 'ffs', 'lol same', 'omg']) {
      expect(isKeymash(line)).toBe(false);
    }
  });

  it('leaves ordinary chat alone', () => {
    for (const line of [
      'pineapple',
      'nah thats not it',
      'attack on titan',
      'the ending was kinda disappointing ngl',
      'i only got through s1 tbh',
      'pepperoni, keep it simple tbh',
    ]) {
      expect(isKeymash(line)).toBe(false);
    }
  });

  it('does not mash back at one person having a moment', () => {
    // The room is still answering the question. A seat that mashes into that
    // has made itself the odd one out from the other direction.
    expect(
      roomIsMashing(
        [mash('asljkdhaslkjd'), mash('pineapple'), mash('yeah exactly')],
        'AI'
      )
    ).toBe(false);
  });

  it('mashes back once the room is doing it', () => {
    expect(
      roomIsMashing([mash('asljkdhaslkjd'), mash('sdkfjhsdkf')], 'AI')
    ).toBe(true);
  });

  it('does not count its own mashing as the room mashing', () => {
    expect(
      roomIsMashing(
        [
          { name: 'AI', text: 'asljkdhaslkjd', replyToName: null },
          { name: 'AI', text: 'sdkfjhsdkf', replyToName: null },
        ],
        'AI'
      )
    ).toBe(false);
  });

  it('writes something that reads as a hand rather than a password', () => {
    // The generator is judged by its own detector: a mash that does not look
    // like one to `isKeymash` does not look like one to the room either.
    const sample = Array.from({ length: 400 }, () => keyboardMash());
    const passing = sample.filter(isKeymash).length;

    expect(passing / sample.length).toBeGreaterThan(0.9);

    // Vowels are what make a random string read as a word. A hand resting on
    // the home row barely finds any.
    const vowelShare =
      sample.reduce(
        (total, line) => total + (line.match(/[aeiou]/g) ?? []).length / line.length,
        0
      ) / sample.length;

    expect(vowelShare).toBeLessThan(0.2);

    // And it never comes out as a held key.
    for (const line of sample) expect(line).not.toMatch(/(.)\1{3,}/);
  });
});

describe('turning up in character', () => {
  /*
   * The rate is overridable from the environment so it can be watched, which
   * means a shell with the override still set would otherwise fail the rarity
   * tests rather than the code being wrong.
   */
  const saved = {};

  beforeEach(() => {
    for (const key of ['IMPOSTOR_BIT', 'IMPOSTOR_BIT_ONE_IN']) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('is rare, because a bit every match teaches the room to hunt the odd seat', () => {
    const rooms = Array.from({ length: 20000 }, (_, i) => `room_${i.toString(36)}`);
    const rate = rooms.filter((room) => bitFor(room)).length / rooms.length;

    expect(rate).toBeGreaterThan(0.03);
    expect(rate).toBeLessThan(0.08);
  });

  it('is the same bit all match, since one that arrives in round two is a glitch', () => {
    const room = Array.from({ length: 20000 }, (_, i) => `room_${i.toString(36)}`).find(
      (candidate) => bitFor(candidate)
    );

    const drawn = Array.from({ length: 20 }, () => bitFor(room).key);

    expect(new Set(drawn).size).toBe(1);
  });

  it('reaches every bit rather than favouring one', () => {
    const rooms = Array.from({ length: 40000 }, (_, i) => `room_${i.toString(36)}_${i * 7919}`);
    const drawn = new Set(rooms.map((room) => bitFor(room)?.key).filter(Boolean));

    expect(drawn.size).toBe(BITS.length);
  });

  it('will not hand a character a two word turn to be one in', () => {
    // Every flat line measured across the six bits came out of the shortest
    // band. Two words cannot carry a voice, and a bit that lapses for one
    // message is worse than no bit.
    const drawn = Array.from({ length: 400 }, () =>
      answerShape(true, { inCharacter: true })
    );

    expect(drawn.every((shape) => shape.words[1] > 3)).toBe(true);
  });

  it('gives the bits that frame an answer room for the frame', () => {
    const drawn = Array.from({ length: 400 }, () =>
      answerShape(true, { inCharacter: true, needsRoom: true })
    );

    expect(drawn.every((shape) => shape.words[1] > 7)).toBe(true);
  });

  it('leaves the length draw alone when there is no bit', () => {
    const drawn = Array.from({ length: 600 }, () => answerShape(true, {}));

    expect(drawn.some((shape) => shape.words[1] <= 3)).toBe(true);
  });

  it('tells the model to hold the bit under accusation and when asked to stop', () => {
    for (const raw of BITS) {
      // A bit whose note depends on the match has to be resolved first.
      const bit = resolveBit(raw, 'room');
      const prompt = systemPrompt({ name: 'AI', brief: 'x', traits: [] }, 40, bit);

      expect(prompt).toContain(bit.note);
      expect(prompt).toContain('including when you are accused');
      expect(prompt).toContain('Never explain the bit');
    }
  });

  it('says nothing about a bit when there is not one', () => {
    const prompt = systemPrompt({ name: 'AI', brief: 'x', traits: [] }, 40, null);

    expect(prompt).not.toContain('The bit:');
  });

  it('can be cranked up to watch it, and forced to one', () => {
    process.env.IMPOSTOR_BIT_ONE_IN = '1';
    expect(bitFor('any room at all')).not.toBeNull();

    delete process.env.IMPOSTOR_BIT_ONE_IN;
    process.env.IMPOSTOR_BIT = 'pirate';
    expect(bitFor('any room at all').key).toBe('pirate');
  });

  it('keeps one star sign for the whole match', () => {
    const astrology = BITS.find((bit) => bit.key === 'astrology');
    const signOf = (note) => note.match(/You are a (\w+)/)?.[1];

    // Answering as a taurus and then defending yourself as a pisces is the
    // room catching you out, not the stars.
    const held = Array.from({ length: 10 }, () =>
      signOf(resolveBit(astrology, 'room_alpha').note)
    );

    expect(new Set(held).size).toBe(1);
    expect(held[0]).toBeTruthy();

    // And it is not the same sign for every room.
    const across = new Set(
      Array.from({ length: 200 }, (_, i) =>
        signOf(resolveBit(astrology, `room_${i}`).note)
      )
    );

    expect(across.size).toBeGreaterThan(6);
  });

  it('says so rather than playing it straight when the name is a typo', () => {
    process.env.IMPOSTOR_BIT = 'anime girl';

    // Silently ignoring this is how you spend an evening wondering why no
    // bit ever turns up.
    expect(() => bitFor('room')).toThrow(/is not a bit/);
  });
});

describe('swearing back at a room that is swearing', () => {
  const sweary = { roomIsSwearing: true, inCharacter: false };

  it('swaps an intensifier in place, so the sentence cannot come out wrong', () => {
    // Appending was tried and removed: it produced "some are actually alright
    // fucking hell", a complaint stapled to a sentence that was not one.
    const swapped = Array.from({ length: 60 }, () =>
      swearBack('some are actually alright', sweary)
    );

    expect(swapped).toContain('some are fucking alright');
    // Never anything but the swap or the original.
    for (const line of swapped) {
      expect(['some are actually alright', 'some are fucking alright']).toContain(line);
    }
  });

  it('leaves a message with nowhere to put one exactly as written', () => {
    for (let i = 0; i < 60; i++) {
      expect(swearBack('yeah exactly', sweary)).toBe('yeah exactly');
    }
  });

  it('does nothing in a room that is not swearing', () => {
    for (let i = 0; i < 60; i++) {
      expect(swearBack('its really annoying', { roomIsSwearing: false, inCharacter: false })).toBe(
        'its really annoying'
      );
    }
  });

  it('keeps out of the way of a bit, which has its own register', () => {
    for (let i = 0; i < 60; i++) {
      expect(swearBack('it is really quite disagreeable', { ...sweary, inCharacter: true })).toBe(
        'it is really quite disagreeable'
      );
    }
  });

  it('leaves a message that already swears, in either form', () => {
    for (const already of ['its really shit', 'wtf is this', 'annoying af']) {
      for (let i = 0; i < 20; i++) expect(swearBack(already, sweary)).toBe(already);
    }
  });

  it('does not touch a trailing intensifier, which has no word after it', () => {
    for (let i = 0; i < 60; i++) {
      expect(swearBack('the pay was bad, not really', sweary)).toBe('the pay was bad, not really');
    }
  });

  it('never swaps a discourse marker wearing an intensifier\'s clothes', () => {
    // Both of these were caught by reading output, not by thinking about it:
    // "fucking i left after a month" and "yeah fucking you're not wrong".
    for (const marker of ['so i left after a month', "yeah well you're not wrong"]) {
      for (let i = 0; i < 40; i++) expect(swearBack(marker, sweary)).toBe(marker);
    }
  });
});

describe('a message that has come apart', () => {
  it('catches a repetition loop', () => {
    // One real turn came back as the word "our" ninety times, and max_tokens
    // was happy to allow it.
    expect(hasDegenerated('our '.repeat(90).trim())).toBe(true);
    expect(hasDegenerated('yeah yeah yeah yeah yeah yeah')).toBe(true);
  });

  it('leaves short repetition alone, which is a person', () => {
    expect(hasDegenerated('no no no')).toBe(false);
    expect(hasDegenerated('yeah exactly')).toBe(false);
  });

  it('leaves ordinary messages alone, bits and mashing included', () => {
    for (const fine of [
      'nah you just had bad luck, some of them arent that bad if you like the people',
      'i wike pawsta, uwu nyaaa owo',
      'arr i be partial to pasta, brings me joy like a chest o rum',
      'asljkdhaslkjd',
      'haha no way, that is actually so funny, i cannot believe you said that',
    ]) {
      expect(hasDegenerated(fine)).toBe(false);
    }
  });
});

describe('names as the room actually types them', () => {
  const { mentionsAnyName } = require('./impostor');

  it('finds the colour on its own, which is the only way anybody types it', () => {
    expect(mentionsAnyName('pink is being weird', ['Mr. Pink'])).toBe(true);
    expect(mentionsAnyName('i think Teal did it', ['Mr. Teal'])).toBe(true);
  });

  it('still finds the full seat name', () => {
    expect(mentionsAnyName('Mr. Pink is being weird', ['Mr. Pink'])).toBe(true);
  });

  it('leaves alone a line that names nobody in the room', () => {
    expect(mentionsAnyName('pink is being weird', ['Mr. Teal', 'Mr. Olive'])).toBe(false);
  });

  it('over-matches an ordinary use of the word, which is the known trade', () => {
    // Documented rather than desired — see the note on namePattern. A spare
    // rewrite is the cheap direction to be wrong in; if this ever costs turns
    // the fix is a context test, not a narrower pattern.
    expect(mentionsAnyName('green tea, every morning', ['Mr. Green'])).toBe(true);
  });
});

describe('the name behind the handle', () => {
  const { nameFor, FIRST_NAMES } = require('./impostor');

  it('gives a room the same name every time it is asked', () => {
    // Nothing stores this; every call in the match has to arrive at it alone.
    expect(nameFor('rm_abc')).toBe(nameFor('rm_abc'));
  });

  it('is a first name and nothing else', () => {
    expect(FIRST_NAMES.every((n) => /^[A-Z][a-z]+$/.test(n))).toBe(true);
  });

  it('is not the seat colour, which is the answer it exists to replace', () => {
    const colours = ['Red', 'Gold', 'Teal', 'Pink', 'Blue', 'Silver', 'Crimson'];
    expect(FIRST_NAMES.some((n) => colours.includes(n))).toBe(false);
  });

  it('spreads across the pool rather than favouring one name', () => {
    const seen = new Set();
    for (let i = 0; i < 4000; i++) seen.add(nameFor(`rm_${i.toString(36)}`));
    expect(seen.size).toBe(FIRST_NAMES.length);
  });

  it('does not move with the bit, which is drawn off the same room', () => {
    // Salted apart on purpose: a room that picks both together is a room the
    // pair can be learned from.
    const rooms = Array.from({ length: 400 }, (_, i) => `rm_${i.toString(36)}`);
    const pairs = new Set(rooms.map((r) => `${nameFor(r)}`));
    expect(pairs.size).toBeGreaterThan(10);
  });
});
