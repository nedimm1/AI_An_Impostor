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
  backedBy,
  canPass,
  canArgue,
  roomWordsFor,
  matchRoom,
  isSarcastic,
  mentionsWhodunit,
  pushTarget,
  askedOf,
  phoneCaps,
  autocapsFor,
  allyAgainst,
  defendedByMe,
  saidNotFollowing,
  accusedByMe,
  castVote,
  isDisagreement,
  isVoteQuestion,
  voteQuestionsTo,
  votePrompt,
  readSituation,
  stanceTable,
  buildMessages,
  STANCES_TALKING,
  coAccused,
  nameUsePolicy,
  asksTheRoom,
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
  REGISTERS,
  registerFor,
  systemPrompt,
  swearBack,
  hasDegenerated,
  inventsAboutThem,
  writeAnswer,
  quietAllMatch,
  isAgreement,
  isAccusation,
  mentionsVoting,
  TYPISTS,
  typistFor,
  blindSpotsFor,
  nicheIn,
  unseenFor,
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

  // A push drawn under somebody's message goes after them, as "you" - it was
  // told to name them and not to name them in the same paragraph.
  it('pushes at the person it is replying to without naming them', () => {
    const content = lastMessage(
      { replyTo: { name: 'Emil', text: 'us version is better fight me' } },
      { ...answerShape(true, {}), stance: 'push', stanceNote: 'x', words: [4, 7], length: 'four to seven words' }
    );
    expect(content).toContain('You are going after Emil');
    expect(content.split('Your message instructions:')[1]).not.toContain('Emil');
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
    const sample = stances({ passable: true });
    expect(new Set(sample)).toEqual(new Set(['own', 'tangent', 'pass']));
    expect(sample.filter((stance) => stance === 'own').length / sample.length)
      .toBeGreaterThan(0.75);
  });

  /*
   * Nobody has a nickname, a karaoke song and a party trick. The seat that
   * produces a considered answer to every one of those is the seat being
   * asked to. Everything else on the list has an answer - see `canPass`.
   */
  it('sometimes has no answer at all, which is a whole message', () => {
    const sample = stances({ passable: true });
    const passed = sample.filter((stance) => stance === 'pass').length / sample.length;

    expect(passed).toBeGreaterThan(0.03);
    expect(passed).toBeLessThan(0.15);
  });

  it('has views once it has answered, and is not shy about them', () => {
    const sample = stances({ laterTurn: true });
    expect(new Set(sample)).toEqual(
      // No `push` here: unprompted, it waits for a vote to argue from.
      new Set(['own', 'build', 'tangent', 'agree', 'disagree', 'redirect', 'sidestep'])
    );
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

  // The shape is pinned rather than drawn: the fixture room reads as talking,
  // so an unpinned draw is an answering turn only a fifth of the time and the
  // test failed about that often.
  it('does not point at one on the turn it is meant to be answering', () => {
    const content = lastMessage(
      { turnNumber: 1 },
      { ...answerShape(true, {}), answering: true, stance: 'own' }
    );
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
/**
 * Quoted under somebody's answer, it has to read the line as their answer.
 *
 * rm_c7wm3l6: "My first car, thanks dad" was Cyan's answer to the best gift
 * they had been given. Quoted bare and invited to ask something, it replied
 * "that is the dream ... what did you get" - eight replays out of eight.
 */
describe('replying to somebody\'s answer', () => {
  const GIFTS = [
    { name: 'Brown', text: 'the gift of life', replyToName: null },
    { name: 'AI', text: 'for me a kindle', replyToName: null },
    { name: 'Cyan', text: 'My first car, thanks dad', replyToName: null },
    { name: 'Brown', text: 'W dad', replyToName: null },
  ];
  const asking = {
    length: 'eight to thirteen words',
    words: [8, 13],
    askQuestion: true,
  };
  const reply = (replyTo, lines = GIFTS) =>
    lastMessage(
      {
        prompt: 'What is the best gift you have been given?',
        roundLines: lines,
        replyTo,
      },
      asking
    );

  it('says the quoted line is their answer', () => {
    expect(reply({ name: 'Cyan', text: 'My first car, thanks dad' })).toContain(
      'That message is their answer to the question'
    );
  });

  it('does not invite a question under it', () => {
    expect(reply({ name: 'Cyan', text: 'My first car, thanks dad' })).not.toContain(
      'tiny natural question'
    );
  });

  it('treats a later line from the same seat as conversation', () => {
    const content = reply({ name: 'Brown', text: 'W dad' });
    expect(content).not.toContain('their answer to the question');
    expect(content).toContain('tiny natural question');
  });

  it('treats a line written at somebody as conversation', () => {
    const content = reply({ name: 'Gold', text: 'Very poetic' }, [
      ...GIFTS,
      { name: 'Gold', text: 'Very poetic', replyToName: 'Brown' },
    ]);
    expect(content).not.toContain('their answer to the question');
  });
});

/**
 * Somebody taking its side is not something to argue with.
 *
 * rm_puehh: it said "my cat", Blue wrote "Me and Mr silver are team cat lol",
 * and it answered "nah dogs are way better, cats are just too moody".
 */
describe('when somebody has taken its side', () => {
  const HOME = [
    { name: 'Olive', text: 'My dog', replyToName: null },
    { name: 'AI', text: 'my cat', replyToName: null },
    { name: 'Red', text: 'Which type you got', replyToName: 'Olive' },
  ];
  const after = (...lines) => [...HOME, ...lines];

  it('reads being backed by name', () => {
    expect(
      backedBy(after({ name: 'Blue', text: 'Me and ai are team cat lol', replyToName: null }), 'AI')
    ).toHaveLength(1);
  });

  it('reads being backed by the arrow', () => {
    expect(backedBy(after({ name: 'Blue', text: 'same', replyToName: 'AI' }), 'AI')).toHaveLength(1);
  });

  it('is not backed by somebody pushing back or asking', () => {
    expect(backedBy(after({ name: 'Red', text: 'nah cats are mid', replyToName: 'AI' }), 'AI')).toEqual([]);
    expect(backedBy(after({ name: 'Red', text: 'what cat is it', replyToName: 'AI' }), 'AI')).toEqual([]);
  });

  it('is not backed by a line about somebody else', () => {
    expect(backedBy(after({ name: 'Blue', text: 'team dog honestly', replyToName: null }), 'AI')).toEqual([]);
  });

  it('is not backed before it has said anything', () => {
    expect(
      backedBy([{ name: 'Blue', text: 'ai will say cat lol', replyToName: null }], 'AI')
    ).toEqual([]);
  });

  it('takes disagreeing off the table', () => {
    const keys = (over) => stanceTable(over).map((option) => option.key);
    expect(keys({})).toContain('disagree');
    expect(keys({ backed: true })).not.toContain('disagree');
  });
});

/**
 * Contractions that do not exist: "honestly’s the best feeling ever" went to
 * the room in rm_c7wm3l6, and "always’ll be team cat" came back in a replay.
 */
describe('contractions it made up', () => {
  it('opens a swallowed "it\'s" back up', () => {
    expect(cleanText('that is the dream, honestly’s the best feeling ever')).toBe(
      'that is the dream, honestly it’s the best feeling ever'
    );
  });

  it('gives a contraction with no word in front its "i" back', () => {
    expect(cleanText('burgers, probably.’ve been eating them way too often')).toBe(
      'burgers, probably. i’ve been eating them way too often'
    );
    expect(cleanText('the ’90s were good')).toBe('the ’90s were good');
  });

  it('spells out a fused will', () => {
    expect(cleanText('always’ll be team cat')).toBe('always will be team cat');
  });

  it('leaves real ones, possessives and the apostrophe style alone', () => {
    for (const said of [
      'i’ll go',
      "you're wrong",
      "they've seen it",
      "i'm in",
      "i'd say pizza",
      'that’s cute',
      "my dad's car",
      "my cat's a menace",
    ]) {
      expect(cleanText(said)).toBe(said);
    }
  });
});

/**
 * A joke on the screen is a joke, not a claim.
 *
 * rm_lb23g: "Well what do YOU eat everyday? Whale liver? Lol", then "as a
 * matter of fact I do" - and it answered "no one actually eats that".
 */
describe('a joke in play', () => {
  const WHALE = [
    { name: 'Yellow', text: 'Pizza', replyToName: null },
    { name: 'Orange', text: 'So generic', replyToName: 'Yellow' },
    { name: 'AI', text: 'idk honestly', replyToName: null },
    { name: 'Yellow', text: 'Well what do YOU eat everyday? Whale liver? Lol', replyToName: 'Orange' },
    { name: 'Orange', text: 'as a matter of fact I do', replyToName: null },
  ];
  const after = (text, replyToName = null) => [
    { name: 'Olive', text: 'pizza', replyToName: null },
    { name: 'AI', text: 'tacos', replyToName: null },
    { name: 'Blue', text, replyToName },
  ];

  it('finds the joke and who is playing along', () => {
    const { bit } = readRoom(WHALE, 'AI');
    expect(bit.name).toBe('Yellow');
    expect(bit.along.text).toBe('as a matter of fact I do');
  });

  it('tells the model not to take it at its word', () => {
    const note = roomNote(readRoom(WHALE, 'AI'));
    expect(note).toContain('Yellow is joking');
    expect(note).toContain('Orange is playing along');
    expect(note).toContain('Do not take it at its word');
  });

  it('does not count a bare laugh as a joke', () => {
    expect(readRoom(after('lol'), 'AI').bit).toBeNull();
  });

  it('never calls a line aimed at it a joke', () => {
    expect(readRoom(after('tacos are for kids lol', 'AI'), 'AI').bit).toBeNull();
    expect(readRoom(after('ai is the bot lol'), 'AI').bit).toBeNull();
    expect(readRoom(after('Then why do you got a cat lol'), 'AI').bit).toBeNull();
  });

  it('lets it go once it has spoken since', () => {
    expect(
      readRoom([...WHALE, { name: 'AI', text: 'lol', replyToName: null }], 'AI').bit
    ).toBeNull();
  });

  it('takes arguing, tangents and changing the subject off the table', () => {
    const keys = (over) => stanceTable(over).map((option) => option.key);
    expect(keys({})).toEqual(expect.arrayContaining(['disagree', 'tangent', 'redirect']));
    for (const key of ['disagree', 'tangent', 'redirect']) {
      expect(keys({ joke: true })).not.toContain(key);
    }
  });
});

/**
 * "idk" is only an answer when not having one is ordinary.
 *
 * rm_lb23g: asked for its favourite food, it sent "idk honestly, i can never
 * actually pick one when people ask this stuff".
 */
describe('passing on a question', () => {
  const PROMPTS = require('../src/game/prompts.json');
  const keys = (over) => stanceTable({ answering: true, ...over }).map((o) => o.key);

  it('is only on the questions you can honestly not have an answer to', () => {
    expect(canPass('What is your favorite food?')).toBe(false);
    expect(canPass('What is the last thing you ate?')).toBe(false);
    expect(canPass('What nickname have you been given?')).toBe(true);
    expect(canPass('What is your go-to karaoke song?')).toBe(true);
    // Most of the list is answerable by anybody.
    expect(PROMPTS.filter(canPass).length).toBeLessThan(PROMPTS.length / 4);
  });

  it('is off the table on the rest', () => {
    expect(keys({})).not.toContain('pass');
    expect(keys({ passable: true })).toContain('pass');
  });

  it('is short when it happens', () => {
    for (let i = 0; i < 400; i++) {
      const shape = answerShape(false, { passable: true });
      if (shape.stance === 'pass') expect(shape.words[1]).toBeLessThanOrEqual(7);
    }
  });

  it('says not having one, not being unable to pick', () => {
    const pass = stanceTable({ answering: true, passable: true }).find((o) => o.key === 'pass');
    expect(pass.note).toContain('never had one');
    expect(pass.note).not.toContain('cant think of one');
  });
});

/**
 * The room swaps the question and it owes the new one an answer of its own.
 *
 * rm_rx7qk: "Forget the question, what is your guys type". It sent "bold
 * choice lol", "yeah, definitely into that look" and "real ones know" - and
 * never a type - while Olive asked it "What about you". Voted out 2-1.
 */
describe('a question the room asked itself', () => {
  const TYPE = [
    { name: 'Olive', text: 'Forget the question, what is your guys type', replyToName: null },
    { name: 'Pink', text: 'I am into goth girls', replyToName: 'Olive' },
  ];
  const PRESSED = [
    ...TYPE,
    { name: 'AI', text: 'bold choice lol', replyToName: null },
    { name: 'Olive', text: 'What about you', replyToName: 'AI' },
  ];

  it('hears a question put to everybody without a question mark', () => {
    expect(asksTheRoom(TYPE[0])).toBe(true);
    expect(asksTheRoom({ text: 'what do you guys think of tacos' })).toBe(true);
    expect(asksTheRoom({ text: 'pizza, what a question' })).toBe(false);
    expect(asksTheRoom({ text: 'doner kebab, what about everyone else' })).toBe(false);
  });

  it('is owed until it has answered, and again when somebody presses', () => {
    expect(readRoom(TYPE, 'AI').roomQuestion.owed).toBe(true);
    expect(readRoom(PRESSED, 'AI').roomQuestion.owed).toBe(true);
    expect(
      readRoom([...PRESSED, { name: 'AI', text: 'sporty girls tbh', replyToName: null }], 'AI')
        .roomQuestion.owed
    ).toBe(false);
  });

  it('only offers an answer of its own while it is owed', () => {
    expect(stanceTable({ roomOwed: true }).map((o) => o.key)).toEqual(['own']);
    expect(stanceTable({ roomOwed: true, challenged: true }).map((o) => o.key)).toContain(
      'defend'
    );
  });

  it('quotes the question and asks for its own answer', () => {
    const content = lastMessage({ prompt: 'What is your favorite smell?', roundLines: TYPE });
    expect(content).toContain('"Forget the question, what is your guys type"');
    expect(content).toContain('Give your own answer to it');
  });

  it('leaves room for an answer under a reply', () => {
    for (let i = 0; i < 300; i++) {
      expect(answerShape(true, { roomOwed: true, replying: true }).words[1]).toBeGreaterThan(3);
    }
  });

  it('does not cut an answer down to the "nah" in front of it', () => {
    expect(
      trimClause('nah, i like blondes more', { clause: false, list: false, words: [4, 7] })
    ).toBe('nah, i like blondes more');
  });
});

/**
 * Talking at the length of the room.
 *
 * rm_c7wm3l6: in a room of "W dad", "Fr" and "Very poetic" it drew fourteen
 * to twenty words. The register is the seat's own; the room pulls on top.
 */
describe('the length the room is typing', () => {
  const lines = (...texts) => texts.map((text, i) => ({ name: `P${i}`, text }));
  const long = (roomWords) => {
    let n = 0;
    for (let i = 0; i < 3000; i++) {
      if (answerShape(true, { laterTurn: true, roomWords }).words[0] >= 14) n++;
    }
    return n / 3000;
  };

  it('reads the median of everybody else', () => {
    expect(roomWordsFor(lines('the gift of life', 'Very poetic', 'W dad', 'Fr', 'My first car, thanks dad'), 'AI')).toBe(2);
    expect(roomWordsFor(lines('Pizza'), 'AI')).toBeNull();
    expect(
      roomWordsFor([...lines('a b', 'c d'), { name: 'AI', text: 'one two three four five six seven' }], 'AI')
    ).toBe(2);
  });

  it('makes long messages rare in a short room', () => {
    expect(long(2)).toBeLessThan(long(null) / 2);
  });

  it('leaves a talkative room alone', () => {
    const bands = [{ min: 8, max: 13, weight: 10 }];
    expect(matchRoom(bands, 12)).toEqual(bands);
  });

  it('still lets a defence or a bit have its room', () => {
    for (let i = 0; i < 200; i++) {
      expect(answerShape(true, { roomWords: 1, inCharacter: true, needsRoom: true }).words[0]).toBeGreaterThan(7);
    }
  });
});

/**
 * Nobody argues with what somebody was given. rm_c7wm3l6 replays: "nah cars
 * are too much work", under Cyan's first car from their dad.
 */
describe('questions that are not for arguing with', () => {
  it('allows it on taste and opinion, not on what happened to somebody', () => {
    expect(canArgue('What is your favorite food?')).toBe(true);
    expect(canArgue('What pizza topping do you actually defend?')).toBe(true);
    expect(canArgue('What is the best gift you have been given?')).toBe(false);
    expect(canArgue('What is the last thing you ate?')).toBe(false);
    expect(canArgue('What is in your pockets right now?')).toBe(false);
  });

  it('lets an argument the room started itself back in', () => {
    const cats = [
      { name: 'Olive', text: 'My dog', replyToName: null },
      { name: 'Blue', text: 'nah cats are better', replyToName: null },
      { name: 'Red', text: 'no way dogs win', replyToName: null },
    ];
    let disagreed = 0;
    for (let i = 0; i < 300; i++) {
      const shape = answerShape(true, {
        laterTurn: true,
        arguable: canArgue("What is on your phone's home screen?") || readRoom(cats, 'AI').arguing,
      });
      if (shape.stance === 'disagree') disagreed++;
    }
    expect(disagreed).toBeGreaterThan(0);
  });

  it('takes disagreeing off the table there', () => {
    const keys = (over) => stanceTable(over).map((o) => o.key);
    expect(keys({})).toContain('disagree');
    expect(keys({ arguable: false })).not.toContain('disagree');
  });
});

// "apple, orange, maybe a grape", after it had already said cereal.
describe('lists', () => {
  it('are never drawn', () => {
    for (let i = 0; i < 2000; i++) {
      expect(answerShape(true, { laterTurn: true }).list).toBe(false);
    }
  });
});

/**
 * rm_4lt7hv4: "Ur mom", "Ur girlfriend", "Wow you guys are so funny" - and it
 * answered "toast with peanut butter, had it for breakfast earlier" as though
 * the room were a form. No laugh anywhere, so none of it registered.
 */
describe('jokes and sarcasm without a laugh', () => {
  const ROOM = [
    { name: 'Orange', text: 'Ur mom', replyToName: null },
    { name: 'Green', text: 'Ur girlfriend', replyToName: null },
    { name: 'Violet', text: 'Wow you guys are so funny', replyToName: null },
  ];

  it('hears an ur-mom joke as a joke', () => {
    expect(readRoom(ROOM.slice(0, 2), 'AI').bit.text).toBe('Ur girlfriend');
  });

  it('hears the eye-roll as sarcasm, not as playing along', () => {
    const read = readRoom(ROOM, 'AI');
    expect(read.sarcasm.name).toBe('Violet');
    expect(read.bit.along).toBeNull();
    const note = roomNote(read);
    expect(note).toContain('Violet is being sarcastic');
    expect(note).toContain('aimed at the jokes');
  });

  it('only calls it sarcasm when it is aimed or unmistakable', () => {
    expect(isSarcastic('Wow you guys are so funny')).toBe(true);
    expect(isSarcastic('very mature')).toBe(true);
    expect(isSarcastic('so original')).toBe(true);
    expect(isSarcastic('you guys are so funny lol')).toBe(false);
    expect(isSarcastic('this is so funny')).toBe(false);
    expect(isSarcastic('that film was hilarious')).toBe(false);
  });

  it('keeps long messages very rare in a two-word room', () => {
    let long = 0;
    for (let i = 0; i < 4000; i++) {
      if (answerShape(true, { roomWords: 2 }).words[0] >= 8) long++;
    }
    expect(long / 4000).toBeLessThan(0.06);
  });
});

/**
 * rm_raf6gls round two: "It wasn't Mr red, who could it be", answered with
 * "reading a book in bed"; then, between Silver and Gold accusing each other,
 * "nah, i think it is them".
 */
describe('the room deciding who it is', () => {
  const OPENER = [{ name: 'Gold', text: 'It wasn’t Mr red, who could it be', replyToName: null }];
  const BOTH = [
    { name: 'Silver', text: 'I think its you Mr gold, ur just agreeing with everyone', replyToName: null },
    { name: 'Gold', text: 'I actually think its U you are the one accusing everyone', replyToName: null },
  ];

  it('hears talk about who it is without the word vote', () => {
    expect(mentionsWhodunit('It wasn’t Mr red, who could it be')).toBe(true);
    expect(mentionsWhodunit('who do you guys think')).toBe(true);
    expect(mentionsWhodunit('who is your favorite singer')).toBe(false);
    expect(mentionsWhodunit('it isn’t that deep')).toBe(false);
    expect(readRoom(OPENER, 'AI').elsewhere).toBe(true);
  });

  it('names who it means', () => {
    const policy = (lines) => nameUsePolicy({ read: readRoom(lines, 'AI') });
    expect(policy(OPENER)).toBe('needed');
    expect(policy(BOTH)).toBe('needed');
    // Quoting somebody still means their name is already on screen.
    expect(nameUsePolicy({ read: readRoom(BOTH, 'AI'), replyTo: BOTH[1] })).toBe('avoid');
  });

  it('knows who is out, and that they were a person', () => {
    const content = lastMessage({
      roundLines: OPENER,
      stillIn: ['Silver', 'Gold', 'AI'],
      ballots: [{ round: 1, votes: [], eliminated: 'Red', tied: null }],
    });
    expect(content).toContain('Voted out so far: Red');
    expect(content).toContain('They were a person');
    expect(content).toContain('Still in: Silver, Gold and AI');
  });
});

/**
 * Going after somebody: a target of its own, a reason that is theirs, and a
 * vote that matches what it told the room.
 */
describe('going after somebody', () => {
  const L = (name, text, replyToName = null) => ({ name, text, replyToName });
  const turn = {
    name: 'AI',
    stillIn: ['Silver', 'Gold', 'AI'],
    ballots: [
      { round: 1, eliminated: 'Red', votes: [{ voter: 'Gold', target: 'Red' }, { voter: 'Silver', target: 'Red' }] },
    ],
    earlier: [{ round: 1, name: 'Gold', text: 'Yeah, since you’re so rich' }],
    roundLines: [
      L('Gold', 'It wasn’t Mr red, who could it be'),
      L('Silver', 'I think its you gold, ur just agreeing with everyone'),
    ],
  };

  it('goes after whoever the room already has, with what they actually did', () => {
    const target = pushTarget(turn, readRoom(turn.roundLines, 'AI'), 'AI');
    expect(target.name).toBe('Gold');
    expect(target.evidence).toContain('said "It wasn’t Mr red, who could it be"');
    expect(target.evidence).toContain('said "Yeah, since you’re so rich" in an earlier round');
    expect(target.evidence).toContain('voted for Red in round 1');
  });

  it('sticks with the one it already accused', () => {
    const mine = { ...turn, roundLines: [...turn.roundLines, L('AI', 'nah its silver, vote silver')] };
    expect(pushTarget(mine, readRoom(mine.roundLines, 'AI'), 'AI').name).toBe('Silver');
  });

  it('never goes after somebody who is already out', () => {
    const target = pushTarget(turn, readRoom(turn.roundLines, 'AI'), 'AI');
    expect(target.name).not.toBe('Red');
  });

  it('pushes mostly when the room is on who it is, rarely otherwise', () => {
    const rate = (over) => {
      let n = 0;
      for (let i = 0; i < 3000; i++) if (answerShape(true, { laterTurn: true, ...over }).stance === 'push') n++;
      return n / 3000;
    };
    expect(rate({ hunting: true, suspicion: true })).toBeGreaterThan(0.2);
    expect(rate({ roomWords: 4 })).toBeLessThan(0.15);
    // Unprompted only once there has been a vote to argue from.
    expect(rate({ roomWords: 4 })).toBe(0);
    expect(rate({ roomWords: 4, afterVote: true })).toBeGreaterThan(0);
    expect(rate({ hunting: true, challenged: true })).toBe(0);
  });

  it('leaves room for the reason', () => {
    for (let i = 0; i < 1000; i++) {
      const shape = answerShape(true, { laterTurn: true, hunting: true, suspicion: true });
      if (shape.stance === 'push') expect(shape.words[1]).toBeGreaterThan(3);
    }
  });

  it('is given the evidence and told to use it', () => {
    const content = lastMessage(
      { ...turn, roundLines: turn.roundLines },
      { ...answerShape(true, {}), stance: 'push', stanceNote: 'x', words: [4, 7], length: 'four to seven words' }
    );
    expect(content).toContain('You are going after Gold');
    expect(content).toContain('voted for Red in round 1');
    expect(content).toContain('Then say you are voting Gold');
  });

  it('votes for who it accused, not for somebody it cleared', async () => {
    expect(accusedByMe([L('AI', 'vote gold, he just agrees with everyone')], 'AI', ['Silver', 'Gold'])).toBe('Gold');
    expect(accusedByMe([L('AI', 'nah gold is fine')], 'AI', ['Silver', 'Gold'])).toBeNull();
    const vote = await castVote({
      name: 'AI',
      persona: { name: 'AI', brief: 'x', traits: [] },
      candidates: ['Silver', 'Gold'],
      roundLines: [L('AI', 'vote gold, he just agrees with everyone')],
    });
    expect(vote.name).toBe('Gold');
  });
});

/**
 * rm_em7vr6j. Round one: Yellow's "Why you doubting the guy so hard?" was at
 * Cyan, and it answered it as if asked. Round two: "I think it's Mr silver"
 * was not read as an accusation, so its defence carried the round's answer
 * with it - "im an aries so i cant help it, tiktok for me".
 */
describe('who a line is actually aimed at', () => {
  const L = (name, text, replyToName = null) => ({ name, text, replyToName });
  const DOUBT = [
    L('Gold', 'To my girl, we broke up'),
    L('AI', 'a meme to my best friend'),
    L('Gold', 'It really happened', 'Cyan'),
    L('Cyan', 'Doubt'),
    L('Yellow', 'Why you doubting the guy so hard?'),
  ];

  it('reads "it\'s <name>" as an accusation', () => {
    const said = [L('Yellow', "Honestly I think it's Mr silver, what's up with him and the signs?")];
    expect(accusationsAgainst(said, 'Mr. Silver')).toHaveLength(1);
    expect(accusationsAgainst([L('Yellow', 'silver what is on your home screen')], 'Mr. Silver')).toHaveLength(0);
    expect(accusationsAgainst([L('Yellow', 'its not silver lol')], 'Mr. Silver')).toHaveLength(0);
  });

  it('knows a "you" question with no arrow is for whoever spoke just before', () => {
    expect(askedOf({ roundLines: DOUBT, replyTo: DOUBT[4] }, 'AI')).toBe('Cyan');
    const toMe = [...DOUBT.slice(0, 2), L('Yellow', 'why a meme though?')];
    expect(askedOf({ roundLines: toMe, replyTo: toMe[2] }, 'AI')).toBeNull();
  });

  it('does not take a question to one person for a question to the room', () => {
    expect(asksTheRoom(DOUBT[4])).toBe(false);
    expect(asksTheRoom(L('Yellow', 'what do you guys think of tacos'))).toBe(true);
    expect(readRoom(DOUBT, 'AI').roomQuestion).toBeNull();
  });

  it('tells it the question was not its to answer', () => {
    const content = lastMessage({ roundLines: DOUBT, replyTo: DOUBT[4] });
    expect(content).toContain('That question was put to Cyan, not to you');
  });
});

/**
 * rm_cia0cbk: "idk dont follow marvel", then "yeah exactly, toby is the only
 * one that actually feels like a movie" two lines later.
 */
describe('something it said it does not follow', () => {
  const L = (name, text) => ({ name, text, replyToName: null });
  const ROUND = [
    L('Silver', 'The new Spider-Man movie, It was pretty good'),
    L('AI', 'idk dont follow marvel'),
    L('Silver', 'Nah tom holland is the best'),
    L('Orange', 'Nooooooo its toby'),
    L('Yellow', 'Tom holland is rly not that bad'),
    L('Orange', 'toby forever'),
  ];

  it('remembers saying it', () => {
    expect(saidNotFollowing(ROUND, 'AI')).toBe('idk dont follow marvel');
    expect(saidNotFollowing([L('AI', 'toby is the best')], 'AI')).toBeNull();
  });

  it('mostly sidesteps, and may change the subject even mid-argument', () => {
    const keys = stanceTable({ outOfIt: true, argument: true }).map((o) => o.key);
    expect(keys).toContain('sidestep');
    expect(keys).toContain('redirect');
    const sample = Array.from(
      { length: 2000 },
      () => answerShape(true, { laterTurn: true, outOfIt: true, argument: true }).stance
    );
    expect(sample.filter((s) => s === 'sidestep').length / 2000).toBeGreaterThan(0.3);
  });

  it('can sidestep now and then on an ordinary turn, but not when a name is up', () => {
    expect(stanceTable({}).map((o) => o.key)).toContain('sidestep');
    expect(stanceTable({ suspicion: true }).map((o) => o.key)).not.toContain('sidestep');
    expect(stanceTable({ challenged: true }).map((o) => o.key)).not.toContain('sidestep');
  });

  it('does not always offer the same example first', () => {
    const firsts = new Set(
      Array.from({ length: 50 }, () =>
        stanceTable({}).find((o) => o.key === 'sidestep').note.match(/"([^"]+)"/)[1]
      )
    );
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('takes no side in the argument about it', () => {
    const keys = stanceTable({ outOfIt: true, argument: true }).map((o) => o.key);
    for (const key of ['agree', 'disagree', 'back']) expect(keys).not.toContain(key);
  });

  it('is reminded of what it said', () => {
    const content = lastMessage({ roundLines: ROUND });
    expect(content).toContain('Earlier this round you said "idk dont follow marvel"');
  });
});

/**
 * rm_5562udw: "bet orane is the one", then under Green's "Wdym too loud?",
 * "just the way you type, im voting you" - at Green. "So you voting me or
 * orange?", and it was voted out.
 */
describe('not switching targets', () => {
  const L = (name, text, replyToName = null) => ({ name, text, replyToName });
  const ROUND = [
    L('Orange', 'Damn so it was not him, now I feel kinda bad'),
    L('AI', 'lol true, bet orane is the one since hes too loud'),
    L('Green', 'Wdym too loud?'),
  ];
  const turn = {
    name: 'AI',
    stillIn: ['Green', 'Orange', 'AI'],
    ballots: [{ round: 1, eliminated: 'Brown', votes: [] }],
    roundLines: ROUND,
    replyTo: { name: 'Green', text: 'Wdym too loud?' },
  };

  it('knows who it accused, typo and all', () => {
    expect(accusedByMe(ROUND, 'AI', ['Green', 'Orange'])).toBe('Orange');
    expect(accusedByMe([L('AI', 'greenery is nice')], 'AI', ['Green', 'Orange'])).toBeNull();
  });

  it('keeps going after them under somebody else\'s message', () => {
    expect(pushTarget(turn, readRoom(ROUND, 'AI'), 'AI').name).toBe('Orange');
  });

  it('is told who "you" is and who it is talking about', () => {
    const content = lastMessage(turn, {
      ...answerShape(true, {}),
      stance: 'push',
      stanceNote: 'x',
      words: [4, 7],
      length: 'four to seven words',
    });
    expect(content).toContain('"you" in it means Green');
    expect(content).toContain('Orange is who you are talking about');
  });

  it('keeps the accusation on the accused whatever it draws, under the asker\'s message', () => {
    for (const stance of ['agree', 'build', 'disagree', 'sidestep']) {
      const content = lastMessage(turn, {
        ...answerShape(true, {}),
        stance,
        stanceNote: 'x',
        words: [4, 7],
        length: 'four to seven words',
      });
      expect(content).toContain('Earlier this round you said it was Orange');
      expect(content).toContain('"you" in it means Green');
      expect(content.split('Your message instructions:')[1]).toContain('Name Orange');
    }
  });

  it('hears "Wdym too loud?" as at it', () => {
    const lines = [...ROUND, L('Orange', 'Yeah? wtf'), L('Green', 'anyway i like chess')];
    expect(repliesTo(lines, 'AI').map((l) => l.text)).toEqual(['Wdym too loud?', 'Yeah? wtf']);
  });

  it('gives everybody\'s record when it has to name somebody', () => {
    // An ordinary stance: a `push` brings its own single-target record instead.
    const content = lastMessage(
      {
        ...turn,
        replyTo: null,
        roundLines: [L('Gold', 'It wasn’t Mr red, who could it be'), L('Orange', 'Yeah lol')],
        stillIn: ['Gold', 'Orange', 'AI'],
      },
      { ...answerShape(true, {}), stance: 'own', stanceNote: 'x', words: [4, 7], length: 'four to seven words' }
    );
    expect(content).toContain('What each of them has actually done this match');
    expect(content).toContain('Orange: said "Yeah lol"');
  });

  it('never mistypes a player\'s name', () => {
    for (let i = 0; i < 500; i++) {
      expect(addNaturalImperfection('bet orange is the one since hes loud', ['Mr. Orange'])).toContain('orange');
    }
  });

  it('keeps the reason and the vote together', () => {
    for (let i = 0; i < 500; i++) {
      const shape = answerShape(true, { laterTurn: true, hunting: true, suspicion: true });
      if (shape.stance === 'push') expect(shape.clause).toBe(true);
    }
  });
});

/**
 * rm_uddixkl. Round two: Pink said "that just leaves u brown, ur the one who
 * accused orange", Brown turned it on the impostor, and it only got annoyed.
 * Round one: "too long is a stretch, lol" about Orange, then a vote for Orange.
 */
describe('an ally, and a vote that matches a defence', () => {
  const L = (name, text, replyToName = null) => ({ name, text, replyToName });
  const R2 = [
    L('Brown', 'Damn I guess it wasn’t him'),
    L('Pink', 'Well I guess that just leaves u brown, ur the one who accused orange'),
    L('Brown', 'I think we should actually vote silver, he’s been too quiet the entire game'),
  ];
  const R1 = [
    L('Brown', 'I think its u orange ur answers are too long'),
    L('Silver', 'yeah exactly, we can just vote based on who is weird', 'Orange'),
    L('Orange', 'Woah rly?! So what if my answers are too long??', 'Brown'),
    L('Brown', 'That’s AI behaviour if u ask me'),
    L('Silver', 'too long is a stretch, lol'),
  ];

  it('reads "leaves u brown" and "its u orange" as accusations', () => {
    expect(accusationsAgainst(R2, 'Brown').map((l) => l.name)).toEqual(['Pink']);
    expect(accusationsAgainst([R1[0]], 'Orange')).toHaveLength(1);
    expect(accusationsAgainst([L('Brown', 'its u that likes orange juice')], 'Orange')).toHaveLength(0);
  });

  it('finds the ally against its accuser, and counters with their point', () => {
    const turn = { stillIn: ['Pink', 'Brown', 'Silver'], roundLines: R2 };
    const accusations = accusationsAgainst(R2, 'Silver');
    expect(allyAgainst(turn, accusations, 'Silver')).toMatchObject({ accuser: 'Brown', ally: 'Pink' });

    let countered = 0;
    for (let i = 0; i < 1000; i++) {
      if (answerShape(true, { underPressure: true, allied: true }).pushback === 'counter') countered++;
    }
    expect(countered / 1000).toBeGreaterThan(0.7);
  });

  it('knows who it stood up for', () => {
    expect(defendedByMe(R1, 'Silver', ['Pink', 'Orange', 'Brown'])).toEqual(['Orange']);
    expect(defendedByMe([L('Silver', 'pizza is fine')], 'Silver', ['Pink'])).toEqual([]);
  });
});

/**
 * 93% of the people's lines in the logs start with a capital - the phone does
 * it - and none of the impostor's did.
 */
describe('autocorrect capitals', () => {
  it('capitalises what the keyboard would, and nothing else', () => {
    expect(phoneCaps('toast lol')).toBe('Toast lol');
    expect(phoneCaps('i think its gold, he said wtf')).toBe('I think its gold, he said wtf');
    expect(phoneCaps('idk. i dont follow marvel')).toBe('Idk. I dont follow marvel');
    expect(phoneCaps('nah im voting orange? he said wtf')).toBe('Nah im voting orange? He said wtf');
    expect(phoneCaps('i’m not a bot')).toBe('I’m not a bot');
    // Names stay as typed; so does a word that only starts with an i.
    expect(phoneCaps('its gold tbh')).toBe('Its gold tbh');
    expect(phoneCaps('in the kitchen')).toBe('In the kitchen');
    expect(phoneCaps('ok its in')).toBe('Ok its in');
  });

  it('is on for most matches and holds for the whole of one', () => {
    let on = 0;
    for (let i = 0; i < 1000; i++) if (autocapsFor(`rm_${i}`)) on++;
    expect(on / 1000).toBeGreaterThan(0.8);
    expect(on / 1000).toBeLessThan(0.97);
    expect(autocapsFor('rm_same')).toBe(autocapsFor('rm_same'));
  });
});

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
  });

  /*
   * Mostly it joins what is being said. Not always: people do drop their own
   * answer into a room mid-argument, and a seat that never once does it is a
   * seat that always does the correct thing.
   */
  it('mostly joins a room that has got talking, and sometimes does not', () => {
    const draws = Array.from(
      { length: 20000 },
      () => answerShape(true, { talking: true }).answering
    );
    const answered = draws.filter(Boolean).length / draws.length;

    expect(answered).toBeGreaterThan(0.1);
    expect(answered).toBeLessThan(0.3);
  });

  /*
   * Two lines is a conversation: somebody says Egypt, somebody writes
   * "overrated imo" under it. Counting two conversational lines missed that,
   * because only the second line in an exchange is aimed — so the impostor
   * walked into the middle of it with a cold answer of its own.
   */
  it('reads one aimed line with a view in it as a conversation starting', () => {
    const opened = [
      { name: 'Nedim', text: 'egypt', replyToName: null },
      { name: 'Emil', text: 'overrated imo', replyToName: 'Nedim' },
    ];
    expect(readRoom(opened, 'AI').talking).toBe(true);

    const asked = [
      { name: 'Nedim', text: 'egypt', replyToName: null },
      { name: 'Emil', text: 'wait when did you go', replyToName: 'Nedim' },
    ];
    expect(readRoom(asked, 'AI').talking).toBe(true);
  });

  it('does not read a reaction or an agreement as one', () => {
    const reacted = [
      { name: 'Nedim', text: 'egypt', replyToName: null },
      { name: 'Emil', text: 'lol egypt', replyToName: 'Nedim' },
    ];
    expect(readRoom(reacted, 'AI').talking).toBe(false);

    const agreed = [
      { name: 'Nedim', text: 'egypt', replyToName: null },
      { name: 'Emil', text: 'yeah same honestly, been wanting to go', replyToName: 'Nedim' },
    ];
    expect(readRoom(agreed, 'AI').talking).toBe(false);
  });

  /*
   * A fifth of the draws into a three-line room came out as "same" or "yeah
   * same" and nothing else. Agreement is most of what a chat is made of, but
   * it needs something to land on: as the whole of the first thing you say
   * into a conversation that has barely started, it is a turn spent saying
   * nothing.
   */
  it('reaches for bare agreement far less in a room two lines deep', () => {
    const rate = (over) => {
      const draws = Array.from(
        { length: 20000 },
        () => answerShape(true, { talking: true, ...over }).stance
      );
      return draws.filter((stance) => stance === 'agree').length / draws.length;
    };

    expect(rate({ shallow: true })).toBeLessThan(rate({}) / 2);
    // Still possible, because people do just agree.
    expect(rate({ shallow: true })).toBeGreaterThan(0.02);
  });

  it('counts the room as shallow off the lines other people have sent', () => {
    const opened = [
      { name: 'Nedim', text: 'egypt', replyToName: null },
      { name: 'Emil', text: 'overrated imo', replyToName: 'Nedim' },
    ];
    expect(readRoom(opened, 'AI').lines).toBe(2);
    expect(readRoom([...opened, { name: 'Kofi', text: 'been twice, its fine' }], 'AI').lines).toBe(
      3
    );
  });

  /* A reply aimed at the impostor is a different brief, not a conversation. */
  it('does not count a line written at itself', () => {
    const atIt = [
      { name: 'Nedim', text: 'egypt', replyToName: null },
      { name: 'Emil', text: 'nah thats overrated', replyToName: 'AI' },
    ];
    expect(readRoom(atIt, 'AI').talking).toBe(false);
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
    const content = lastMessage(
      { roundLines: ARGUING, turnNumber: 1 },
      { ...answerShape(true, {}), answering: false }
    );
    expect(content).toContain('the room has stopped going round it');
    expect(content).not.toContain('it is your turn to put up yours');
  });

  /*
   * What the room has got onto is a thing, not a question, and it is allowed
   * to know the thing. Its own answer arrives sideways or not at all.
   */
  it('tells it that it can have been to the place they are arguing about', () => {
    const content = lastMessage(
      { roundLines: ARGUING, turnNumber: 1 },
      { ...answerShape(true, {}), answering: false }
    );
    expect(content).toContain('It is a thing now, not a question');
    expect(content).toContain('gets your answer in sideways');
  });

  it('still answers when the room is going round the question', () => {
    const content = lastMessage(
      { roundLines: ANSWERING, turnNumber: 1 },
      { ...answerShape(true, {}), answering: true, stance: 'own' }
    );
    expect(content).toContain('it is your turn to put up yours');
  });

  /*
   * Second in the queue is not the same turn as first in the queue.
   *
   * It was being told to put its answer up and nothing else, so with one
   * person already having said pineapple it said pepperoni into the void -
   * a line that would have read identically if the screen had been blank.
   * People answer through what is above them: "me too lol", or theirs next
   * to the one before it.
   */
  it('answers through the answers already on the screen', () => {
    const content = lastMessage(
      { roundLines: ANSWERING, turnNumber: 1 },
      { ...answerShape(true, {}), answering: true, stance: 'own' }
    );
    expect(content).toContain('answering after somebody, not into an empty room');
    expect(content).toContain('me too lol');
    // Not a verdict on theirs and then yours: "pizza is classic, burgers for
    // me" was two messages in one.
    expect(content).toContain('not a verdict on theirs and then yours');
    expect(content).not.toContain(
      "Do not spend your turn on somebody else's answer"
    );
  });

  // And it is not a template. Every line opening "for me its" is its own
  // pattern, and a more visible one than the thing it replaced.
  it('does not sell those two shapes as a formula', () => {
    const content = lastMessage(
      { roundLines: ANSWERING, turnNumber: 1 },
      { ...answerShape(true, {}), answering: true, stance: 'own' }
    );
    expect(content).toContain('Neither of those is a formula');
  });

  // First to answer has nothing to answer through, and telling it not to
  // post over the top of a room that does not exist is how a seat ends up
  // hedging at an empty screen.
  it('does not tell the first speaker to read the screen', () => {
    const content = lastMessage(
      { roundLines: [], turnNumber: 1 },
      { ...answerShape(false, {}), answering: true, stance: 'own' }
    );
    expect(content).toContain('nobody has answered it yet');
    expect(content).not.toContain('me too lol');
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
    // Pinned: an unpinned draw can come out `redirect`, which is a turn that
    // deliberately does not carry on from what has been said.
    expect(
      lastMessage(
        { roundLines: spoken, turnNumber: 2 },
        { ...answerShape(true, {}), answering: false, stance: 'own' }
      )
    ).toContain('already answered the question earlier');
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

    // Was 0.1. `push` (going after somebody itself) now takes a share of the
    // suspicion turns, deliberately - it was made more aggressive - so doubt
    // is a smaller slice; what matters is that it stays well above piling.
    expect(rate(false)).toBeGreaterThan(0.07);
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
    // Going after somebody itself (`push`) counts: it is a view about who it is.
    const view = rate('pile') + rate('doubt') + rate('push');
    expect(view).toBeGreaterThan(0.35);
    expect(view).toBeLessThan(0.8);
    // Backing every accusation would be its own pattern. 0.07 rather than
    // 0.1 since `push` took a share of these turns (see the piling test).
    expect(rate('doubt')).toBeGreaterThan(0.07);
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
    const keys = stanceTable({
      answering: true,
      challenged: true,
      argument: true,
      passable: true,
    }).map((o) => o.key);
    expect(keys).toEqual(['own', 'tangent', 'pass']);
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

/**
 * Being asked about a vote everybody can see.
 *
 * The result screen draws each vote with the voter's face under the name they
 * picked, so the ballot is public and stays public. Two things were wrong
 * with that. The impostor could not see its own vote at all — it is the one
 * player at the table who was not handed the sheet everybody else is holding
 * — and "why did you vote for me" arrived as an accusation, because `vote` is
 * in the accusation markers, so a plain question got a defence of its own
 * humanity for an answer.
 */
describe('being asked about its vote', () => {
  const BALLOTS = [
    {
      round: 1,
      yours: 'Emil',
      eliminated: 'Emil',
      votes: [
        { voter: 'AI', target: 'Emil' },
        { voter: 'Nedim', target: 'Emil' },
      ],
    },
    {
      round: 2,
      yours: 'Nedim',
      eliminated: null,
      votes: [
        { voter: 'AI', target: 'Nedim' },
        { voter: 'Nedim', target: 'Emil' },
        { voter: 'Kofi', target: 'Nedim' },
      ],
    },
  ];

  const asked = {
    ballots: BALLOTS,
    roundLines: [
      ...ROOM,
      { name: 'Nedim', text: 'why did you vote for me', replyToName: 'AI' },
    ],
  };

  /*
   * The follow-up rarely says "vote" again — it is "no but why me though",
   * written at the shrug it just got — so what marks the second push is the
   * shape of it and not the word.
   */
  const pressed = {
    ballots: BALLOTS,
    roundLines: [
      ...ROOM,
      { name: 'Nedim', text: 'why did you vote for me', replyToName: 'AI' },
      { name: 'AI', text: 'had to be someone', replyToName: 'Nedim' },
      { name: 'Nedim', text: 'no but why me', replyToName: 'AI' },
    ],
  };

  it('tells a question about the ballot apart from a charge', () => {
    expect(isVoteQuestion('why did you vote for me')).toBe(true);
    expect(isVoteQuestion('you voted me lol')).toBe(true);

    // Still open, still a threat: that one belongs with the accusations.
    expect(isVoteQuestion('im voting you')).toBe(false);
    // And a charge that happens to mention the ballot is a charge.
    expect(isVoteQuestion('you voted kofi and youre the ai')).toBe(false);
  });

  it('picks up the question whether it is named or replied to', () => {
    const named = voteQuestionsTo(
      [{ name: 'Nedim', text: 'AI why did you vote for me', replyToName: null }],
      'AI'
    );
    const replied = voteQuestionsTo(asked.roundLines, 'AI');

    expect(named).toHaveLength(1);
    expect(replied).toHaveLength(1);
  });

  it('does not put it into a defence of being human', () => {
    expect(accusationsAgainst(asked.roundLines, 'AI')).toHaveLength(0);
    expect(lastMessage(asked)).not.toContain('accused you of being the AI');
  });

  it('hands it the vote it actually cast', () => {
    const content = lastMessage(asked);
    expect(content).toContain('you voted for Nedim');
    expect(content).toContain('Kofi voted for Nedim');
    expect(content).toContain('asked you about your vote');
  });

  /*
   * "you voted for him last time as well" is a question about the run. One
   * round of it cannot answer that, so every round goes in — a match is four
   * rounds long, so this is twenty lines at the very most.
   */
  it('hands it the earlier rounds too, not just the last one', () => {
    const content = lastMessage(asked);
    expect(content).toContain('Round 1 - Emil went');
    expect(content).toContain('Round 2 - nobody went');
  });

  it('says out loud when it has voted for the same player twice', () => {
    const twice = {
      ...asked,
      ballots: BALLOTS.map((ballot) => ({ ...ballot, yours: 'Nedim' })),
    };
    expect(lastMessage(twice)).toContain('not the first time you have voted for Nedim');
    expect(lastMessage(asked)).not.toContain('not the first time');
  });

  /*
   * It never hands over its reasoning, however hard it is pushed.
   *
   * A reason has to come out of something, and the only somethings available
   * are claims about people who are sitting right there and can scroll back
   * through the round to check them — so it invented, and the invented half
   * was always the checkable half: "you said pizza like ten times" (it was
   * three), "you kept saying pizza more than anyone else" (they all did). A
   * shrug has nothing in it for the room to take apart.
   */
  it('never gives a reason, only a shrug', () => {
    const content = lastMessage(asked);

    expect(content).toContain('You do not have a reason and you are not going to produce one');
    expect(content).toContain('idk i didnt know who else to vote for');
    expect(content).toContain('do not explain');
    // It still cannot deny the vote: the room is looking at it.
    expect(content).toContain('do not name anybody else');
  });

  it('holds the same answer when they will not let it go', () => {
    const content = lastMessage(pressed);

    expect(content).toContain('They have asked again, and the answer is the same one');
    expect(content).toContain('shorter and flatter');
    // The second ask is where a model caves and starts explaining.
    expect(content).toContain('Do not start explaining because somebody pushed you');
  });

  /* Being accused is the other way the room pushes, and it changes nothing. */
  it('holds it under accusation too', () => {
    const accusedToo = {
      ...asked,
      roundLines: [...asked.roundLines, { name: 'Kofi', text: 'AI is the bot, obviously' }],
    };
    expect(lastMessage(accusedToo)).toContain('They have asked again');
  });

  /*
   * The ballot is only worth sending when it is the subject. On an ordinary
   * turn a list of who voted for whom is one more thing to have an opinion
   * about, and it will.
   */
  it('says nothing about the ballot when nobody has brought it up', () => {
    const quiet = lastMessage({ ballots: BALLOTS });
    expect(quiet).not.toContain('Every vote in this match');
  });

  it('brings it up unasked on a tiebreaker, where it is why they are talking', () => {
    const tie = lastMessage({ ballots: BALLOTS, tiebreaker: true, accused: true });
    expect(tie).toContain('Every vote in this match');
  });

  it('has nothing to say about a ballot that has not happened', () => {
    const firstRound = { ...asked, ballots: [] };
    expect(lastMessage(firstRound)).not.toContain('you voted for');
  });

  /*
   * The vote used to be described to the model as secret - "Nobody can see
   * your individual vote. Only the final vote totals are shown." - which was
   * true when it was written and is not now. A model told its vote is private
   * has no reason to weigh a pick it will be asked about out loud.
   */
  it('does not tell it the ballot is secret', () => {
    const prompt = votePrompt({ name: 'AI' });
    expect(prompt).toContain('Everybody will see who you picked');
    expect(prompt).not.toMatch(/nobody can see your (individual )?vote/i);
    expect(prompt).toContain('Would that name need explaining?');
  });
});


/**
 * How long this seat talks, for a whole match rather than for a turn.
 *
 * Every message was already drawn from a length table, but always the same
 * one, so every match came out at the same average: a seat that mostly sends
 * eight to thirteen words, every round, in every room. Real people are not
 * distributed like that - one of them answers everything in two words all
 * evening - and what gives a seat away is not the length of a message, it is
 * the length of all of them together.
 */
describe('how much this one talks', () => {
  const band = (register, runs = 20000) =>
    Array.from({ length: runs }, () => answerShape(true, { register }).words[1]);

  const clipped = REGISTERS.find((r) => r.key === 'clipped');
  const talkative = REGISTERS.find((r) => r.key === 'talkative');

  it('gives some matches a seat that answers in a handful of words', () => {
    const sample = band(clipped);
    const short = sample.filter((words) => words <= 7).length / sample.length;

    expect(short).toBeGreaterThan(0.75);
    // Never mute, though: a seat that cannot write a sentence is its own tell.
    expect(sample.some((words) => words >= 8)).toBe(true);
  });

  it('gives others one that says the whole thought', () => {
    const sample = band(talkative);
    const long = sample.filter((words) => words >= 14).length / sample.length;

    expect(long).toBeGreaterThan(0.15);
    expect(sample.filter((words) => words <= 3).length / sample.length).toBeLessThan(0.15);
  });

  /* Whatever it is, it is that for the whole match - a register that changed
   * every turn would be nobody at all. */
  it('holds still inside a match and moves between them', () => {
    expect(registerFor('rm_abc').key).toBe(registerFor('rm_abc').key);

    const rooms = Array.from({ length: 300 }, (_, i) => registerFor(`rm_${i.toString(36)}`).key);
    expect(new Set(rooms).size).toBe(REGISTERS.length);

    const clippedRooms = rooms.filter((key) => key === 'clipped').length / rooms.length;
    expect(clippedRooms).toBeGreaterThan(0.15);
    expect(clippedRooms).toBeLessThan(0.45);
  });

  /* The rules that need room still get the last word on a given turn. */
  it('still gives a bit and a defence the room they need', () => {
    const inCharacter = band(clipped, 4000);
    expect(
      Array.from({ length: 4000 }, () =>
        answerShape(true, { register: clipped, inCharacter: true, needsRoom: true }).words[0]
      ).every((min) => min >= 4)
    ).toBe(true);
    expect(inCharacter.some((words) => words <= 3)).toBe(true);
  });
});


/**
 * A room that never went near the question in the first place.
 *
 * Two of these, and the reply arrow cannot see either. A second round opens
 * on a new prompt and the room carries straight on with the vote — "why did
 * yall vote me", a name still going round — and nobody is replying to
 * anybody, they are all just still in the last round. Or a first round opens
 * and the first person ignores the prompt and asks the room something of
 * their own. Both times the impostor walked in with a tidy answer to a
 * question everybody else had forgotten about.
 */
describe('a room that is somewhere else entirely', () => {
  const ON_THE_VOTE = [
    { name: 'Nedim', text: 'why did yall vote me last round', replyToName: null },
    { name: 'Emil', text: 'i still think it was blue tbh', replyToName: null },
  ];

  const OWN_QUESTION = [{ name: 'Nedim', text: 'anyone else here from the uk?', replyToName: null }];

  it('knows the room is still on the vote', () => {
    expect(readRoom(ON_THE_VOTE, 'AI').elsewhere).toBe(true);
    expect(readRoom([{ name: 'Nedim', text: 'blue is deffo the bot' }], 'AI').elsewhere).toBe(true);
  });

  it('knows somebody has asked the room their own thing', () => {
    expect(readRoom(OWN_QUESTION, 'AI').elsewhere).toBe(true);
    expect(readRoom([{ name: 'Nedim', text: 'wait what even happened' }], 'AI').elsewhere).toBe(
      true
    );
  });

  /*
   * "pizza, you?" is an answer with a question stapled to the back of it, and
   * reading that as somebody changing the subject took it off answering on
   * the one turn it was supposed to be answering on.
   */
  /*
   * The most explicit version of changing the subject does not start with the
   * question, and it was the one shape that did not register at all: the seat
   * put its favourite food up underneath a question about a film.
   */
  it('reads a question that does not open the line', () => {
    expect(
      asksTheRoom({
        text: 'forget the question, what did yall think of the new spiderman movie?',
      })
    ).toBe(true);
    expect(asksTheRoom({ text: 'ok random what are yall doing this weekend?' })).toBe(true);
    expect(asksTheRoom({ text: 'off topic but who else is tired?' })).toBe(true);

    // Still needs a question in it somewhere.
    expect(asksTheRoom({ text: 'pizza, what a question' })).toBe(false);
    expect(asksTheRoom({ text: 'doner kebab, the garlic sauce one' })).toBe(false);
  });

  it('takes that turn away from answering the question at the top', () => {
    const read = readRoom(
      [
        {
          name: 'Mr. Blue',
          text: 'forget the question, what did yall think of the new spiderman movie?',
          replyToName: null,
        },
      ],
      'Mr. Red'
    );
    expect(read.elsewhere).toBe(true);
  });

  it('does not take an answer that asks back for a change of subject', () => {
    expect(asksTheRoom({ text: 'pizza, you?' })).toBe(false);
    expect(asksTheRoom({ text: 'doner kebab, what about everyone else' })).toBe(false);
    expect(asksTheRoom({ text: 'anyone else from the uk?' })).toBe(true);

    // Aimed at one person is a conversation, which has a brief of its own.
    expect(asksTheRoom({ text: 'what did you mean by that?', replyToName: 'AI' })).toBe(false);

    const answers = [
      { name: 'Nedim', text: 'pizza' },
      { name: 'Emil', text: 'kebab, you?' },
      { name: 'Kofi', text: 'sushi' },
    ];
    expect(readRoom(answers, 'AI').elsewhere).toBe(false);
  });

  /*
   * Not even occasionally. A room arguing about the answers is still on the
   * question, so putting yours up over the top of it is clumsy rather than
   * impossible — but a conversation that is not the question at all started
   * while this seat sat there, and there is no version of answering the
   * prompt into it that reads as a person.
   */
  it('never answers the prompt into a conversation that has started without it', () => {
    const draws = Array.from(
      { length: 20000 },
      () => answerShape(true, { elsewhere: true }).answering
    );
    expect(draws.some(Boolean)).toBe(false);

    // A room still on the question is the other case, and that one it can.
    const talking = Array.from(
      { length: 20000 },
      () => answerShape(true, { talking: true }).answering
    );
    expect(talking.filter(Boolean).length / talking.length).toBeGreaterThan(0.1);
  });

  it('is told what the room is actually on', () => {
    const vote = lastMessage(
      { roundLines: ON_THE_VOTE, turnNumber: 1 },
      { ...answerShape(true, {}), answering: false, stance: 'own', stanceNote: 'x' }
    );
    expect(vote).toContain('Nobody is answering the question');
    expect(vote).toContain('still on the vote');
    expect(vote).not.toContain('it is your turn to put up yours');

    const asked = lastMessage(
      { roundLines: OWN_QUESTION, turnNumber: 1 },
      { ...answerShape(true, {}), answering: false, stance: 'own', stanceNote: 'x' }
    );
    expect(asked).toContain('asked the room something of their own');
    expect(asked).toContain('Answer what they asked');
  });
});


/*
 * Nobody has seen everything.
 *
 * The room lands on an anime and the seat that always has a view about it is
 * the seat that has seen everything anybody names, which no person has.
 */
describe('things it does not follow', () => {
  const asked = [
    {
      name: 'Nedim',
      text: 'What did yall think of the ending to the Attack on Titan?',
      replyToName: null,
    },
  ];

  it('holds the same two genres all match', () => {
    const first = blindSpotsFor('r1').map((spot) => spot.key);
    const second = blindSpotsFor('r1').map((spot) => spot.key);
    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(new Set(first).size).toBe(2);
  });

  it('gives different rooms different ones', () => {
    const seen = new Set(
      Array.from({ length: 30 }, (_, i) =>
        blindSpotsFor(`room${i}`)
          .map((spot) => spot.key)
          .join(',')
      )
    );
    expect(seen.size).toBeGreaterThan(3);
  });

  // The same show twice in one match has to get the same answer. A coin flip
  // per turn dodges it in one message and reviews it in the next.
  it('answers the same about the same thing all match', () => {
    const answers = Array.from({ length: 20 }, () =>
      JSON.stringify(unseenFor('r1', asked, 'AI'))
    );
    expect(new Set(answers).size).toBe(1);
  });

  // The point of the whole thing: most of the room has not seen it.
  it('has not seen it far more often than it has', () => {
    const out = Array.from({ length: 400 }, (_, i) =>
      unseenFor(`room${i}`, asked, 'AI')
    );
    const share = out.filter(Boolean).length / out.length;
    expect(share).toBeGreaterThan(0.5);
    expect(share).toBeLessThan(0.85);
  });

  // And it is still a room where people talk about the things they like.
  it('still knows some of them', () => {
    const out = Array.from({ length: 400 }, (_, i) =>
      unseenFor(`room${i}`, asked, 'AI')
    );
    expect(out.filter((one) => one === null).length).toBeGreaterThan(40);
  });

  /*
   * A word that is also an ordinary word turns a question about lunch into
   * "idk never watched it", which is stranger than anything this fixes.
   */
  it('does not fire on the questions the game actually asks', () => {
    const prompts = require('../src/game/prompts.json');
    expect(prompts.filter((prompt) => nicheIn(prompt))).toEqual([]);
  });

  it('does not fire on ordinary chat', () => {
    const ordinary = [
      'pineapple',
      'doner kebab',
      'i saw it last week',
      'nah thats not it',
      'why did yall vote me',
      'idk you just seemed sus',
      'the city centre one',
    ];
    for (const line of ordinary) {
      expect(nicheIn(line)).toBeNull();
    }
  });

  it('reads the thing the room is actually on', () => {
    expect(nicheIn('the ending to Attack on Titan').key).toBe('anime');
    expect(nicheIn('the new spiderman was mid').key).toBe('superhero');
    expect(nicheIn('did you watch love island').key).toBe('reality');
  });

  // Its own line does not count: it is the room that put the thing up.
  it('ignores what it said itself', () => {
    expect(
      unseenFor('r1', [{ name: 'AI', text: 'attack on titan is good' }], 'AI')
    ).toBeNull();
  });

  /*
   * Being asked why you voted somebody out is not a turn you get to sit out
   * because an anime came up two lines above.
   */
  it('does not sit out a turn it is being accused on', () => {
    const shape = answerShape(true, {
      unseen: { kind: 'genre', label: 'anime', out: 'idk i dont watch anime' },
      underPressure: true,
    });
    expect(shape.stance).not.toBe('unseen');
  });

  it('is told to say it and stop', () => {
    const shape = answerShape(true, {
      unseen: { kind: 'genre', label: 'anime', out: 'idk i dont watch anime' },
    });
    expect(shape.stance).toBe('unseen');
    expect(shape.stanceNote).toContain('idk i dont watch anime');
    expect(shape.stanceNote).toContain('do not ask them to explain it');
    expect(shape.list).toBe(false);
    expect(shape.askQuestion).toBe(false);
    expect(shape.words[1]).toBeLessThanOrEqual(7);
  });

  it('does not also tell it to answer the question', () => {
    const content = lastMessage(
      {
        roundLines: [
          { name: 'Nedim', text: 'the attack on titan ending was rough' },
        ],
        turnNumber: 1,
      },
      answerShape(true, {
        unseen: { kind: 'genre', label: 'anime', out: 'idk i dont watch anime' },
      })
    );
    expect(content).toContain('something you have not seen');
    expect(content).not.toContain('it is your turn to put up yours');
  });

  it('puts the two it does not follow in the system prompt', () => {
    const spots = blindSpotsFor('r1');
    const prompt = systemPrompt(
      { name: 'AI', brief: 'x', traits: [] },
      40,
      null,
      'AI',
      spots
    );
    expect(prompt).toContain(spots[0].label);
    expect(prompt).toContain(spots[1].label);
    expect(prompt).toContain('idk didnt watch it');
  });

  // The niche it does know is still the niche it knows: how a thing landed,
  // never a fact that can be looked up.
  it('still forbids anything lookup-shaped', () => {
    const prompt = systemPrompt(
      { name: 'AI', brief: 'x', traits: [] },
      40,
      null,
      'AI',
      blindSpotsFor('r1')
    );
    expect(prompt).toContain(
      'What you cannot be right about is anything that has to be looked up'
    );
    expect(prompt).toContain('what happened in a numbered episode');
  });
});


/*
 * A seat that mistypes three messages in ten, every match, is a distribution
 * rather than a person - the same thing REGISTERS was written to fix about
 * message length.
 */
describe('how badly this one types', () => {
  it('holds still inside a match', () => {
    expect(typistFor('r1').key).toBe(typistFor('r1').key);
  });

  it('gives different rooms different typists', () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) => typistFor(`room${i}`).key)
    );
    expect(seen.size).toBe(3);
  });

  // The room still averages what it averaged before; it is the spread across
  // seats that was missing, not the level.
  it('leaves the population rate where it was', () => {
    const total = TYPISTS.reduce((sum, one) => sum + one.weight, 0);
    const mean =
      TYPISTS.reduce((sum, one) => sum + one.weight * one.rate, 0) / total;
    expect(mean).toBeCloseTo(0.3, 3);
  });

  it('actually changes how often a seat is sloppy', () => {
    const rate = (key) => {
      const typist = TYPISTS.find((one) => one.key === key);
      const draws = Array.from(
        { length: 600 },
        () => answerShape(true, { typist }).sloppy
      );
      return draws.filter(Boolean).length / draws.length;
    };

    const clean = rate('clean');
    const messy = rate('messy');

    expect(clean).toBeLessThan(0.15);
    expect(messy).toBeGreaterThan(0.45);
    expect(messy).toBeGreaterThan(clean * 3);
  });

  // Somebody who answers in three words is not thereby somebody who
  // misspells them.
  it('is drawn separately from how much it says', () => {
    const pairs = new Set(
      Array.from(
        { length: 120 },
        (_, i) => `${registerFor(`room${i}`).key}:${typistFor(`room${i}`).key}`
      )
    );
    expect(pairs.size).toBeGreaterThan(5);
  });

  it('says which one it drew', () => {
    const shape = answerShape(true, { typist: TYPISTS[0] });
    expect(shape.typist).toBe('clean');
  });
});


/*
 * The screen only holds the round it is on. The people in front of it do not
 * have that limit, and the impostor was the only seat starting every round
 * from nothing.
 */
describe('what it remembers of earlier rounds', () => {
  const earlier = [
    { round: 1, name: 'Mr. Blue', text: 'pizza' },
    { round: 1, name: 'Mr. Olive', text: 'doner kebab' },
  ];

  const messagesFor = (over = {}) =>
    buildMessages({
      ...turn(over),
      persona: { name: 'AI', brief: 'x', traits: [] },
    })
      .map((message) => message.content)
      .join('\n');

  it('hands it what the others said before this round', () => {
    const all = messagesFor({ earlier, ownHistory: [] });
    expect(all).toContain('What the others said in earlier rounds');
    expect(all).toContain('round 1, Mr. Blue: pizza');
  });

  // It is the only seat that could quote those lines, because nobody else can
  // see them any more.
  it('tells it that it is memory rather than a transcript', () => {
    const all = messagesFor({ earlier, ownHistory: [] });
    expect(all).toContain('Nobody can scroll back to those');
    expect(all).toContain('do not repeat one word for word');
  });

  it('still carries its own lines separately', () => {
    const all = messagesFor({ earlier, ownHistory: ['i said this'] });
    expect(all).toContain('Your previous messages in this match were');
    expect(all).toContain('i said this');
    expect(all).toContain('round 1, Mr. Olive: doner kebab');
  });

  // Round one has no earlier rounds, and the block has to be absent rather
  // than present and empty.
  it('says nothing about memory in the first round', () => {
    const all = messagesFor({ earlier: [], ownHistory: [] });
    expect(all).not.toContain('earlier rounds');
  });

  it('remembers a bounded amount of it', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      round: 1,
      name: 'Mr. Blue',
      text: `line ${i}`,
    }));
    const all = messagesFor({ earlier: many, ownHistory: [] });
    expect(all).toContain('line 29');
    expect(all).not.toContain('line 5,');
  });
});


/*
 * It can follow a change of subject now. The seat that never once makes one
 * is the most reliably on-topic player in the room, which is its own shape.
 */
describe('changing the subject itself', () => {
  const quiet = {
    answering: false,
    argument: false,
    challenged: false,
    replying: false,
    suspicion: false,
    unanswered: false,
    shallow: false,
  };

  const offers = (over = {}) =>
    stanceTable({ ...quiet, ...over }).some((one) => one.key === 'redirect');

  it('is on the table in a room with nothing going on', () => {
    expect(offers()).toBe(true);
  });

  it('is a small share of those turns', () => {
    const pool = stanceTable(quiet);
    const total = pool.reduce((sum, one) => sum + one.weight, 0);
    const redirect = pool.find((one) => one.key === 'redirect');
    expect(redirect.weight / total).toBeLessThan(0.08);
  });

  /*
   * Changing the subject while a name is in the frame is the move of a player
   * who wants the subject changed, and this room votes on exactly that.
   */
  it('is off the table while somebody is under suspicion', () => {
    expect(offers({ suspicion: true })).toBe(false);
  });

  it('is off the table mid-argument, mid-reply and while it owes an answer', () => {
    expect(offers({ argument: true })).toBe(false);
    expect(offers({ replying: true })).toBe(false);
    expect(offers({ challenged: true })).toBe(false);
    expect(offers({ unanswered: true })).toBe(false);
  });

  // Three lines in there is nothing to change the subject away from.
  it('is off the table in a room that has barely started', () => {
    expect(offers({ shallow: true })).toBe(false);
  });

  it('never fires on the turn everybody is answering', () => {
    expect(offers({ answering: true })).toBe(false);
  });

  // The system prompt bans dropping a title nobody mentioned, and this is the
  // one stance that could walk around it.
  it('does not let it pick a topic it can be knowledgeable about', () => {
    const note = stanceTable(quiet).find((one) => one.key === 'redirect').note;
    expect(note).toContain('Not a title');
    expect(note).toContain('something everybody in the room can answer');
  });
});


/*
 * A turn that runs out draws a bubble under that seat's name saying "ran out
 * of time". Everybody sees it. The payload filtered those lines out, so the
 * impostor was the one seat in the room that could not.
 */
describe('turns that produced nothing', () => {
  const said = (over) =>
    buildMessages({
      ...turn(over),
      persona: { name: 'AI', brief: 'x', traits: [] },
    })
      .map((message) => message.content)
      .join('\n');

  it('is told who sat their turn out', () => {
    const all = said({
      roundLines: [{ name: 'Mr. Blue', text: 'pizza', replyToName: null }],
      silent: [{ name: 'Mr. Pink', lostConnection: false }],
    });
    expect(all).toContain('Mr. Pink ran out of time and sent nothing');
    expect(all).toContain('The room watched that happen');
  });

  // Running out of time and dropping out are different things to have
  // happened to somebody, and the room is shown which.
  it('tells the two apart', () => {
    const all = said({
      roundLines: [],
      silent: [{ name: 'Mr. Olive', lostConnection: true }],
    });
    expect(all).toContain('Mr. Olive lost connection before finishing');
    expect(all).not.toContain('Mr. Olive ran out of time');
  });

  it('does not report its own missed turn back to it', () => {
    const all = said({
      roundLines: [],
      silent: [{ name: 'AI', lostConnection: false }],
    });
    expect(all).not.toContain('AI ran out of time');
  });

  it('says nothing at all when everybody answered', () => {
    const all = said({
      roundLines: [{ name: 'Mr. Blue', text: 'pizza', replyToName: null }],
      silent: [],
    });
    expect(all).not.toContain('ran out of time');
  });
});


/*
 * The markers are how the room is read, and a phrasing they miss is a thing
 * that did not happen as far as the impostor is concerned.
 */
describe('reading what the room actually types', () => {
  it('reads an accusation that never says bot', () => {
    for (const line of [
      'no human types like that',
      'somethings off about that answer',
      'that reads like chatgpt',
      'my money is on olive',
      'pink hasnt said anything all game',
      'it was written by something',
    ]) {
      expect(isAccusation(line)).toBe(true);
    }
  });

  // It is told to say "fax" itself in the agree stance, and could not
  // recognise it coming back the other way.
  it('reads the agreement it is itself told to type', () => {
    for (const line of ['fax', 'facts', 'fr', 'ong', '+1', 'no cap']) {
      expect(isAgreement(line)).toBe(true);
    }
  });

  /*
   * Ordinary words on their own and ordinary words in a sentence are not the
   * same thing. "bet" is agreement; "i had a bet on the game" is an answer.
   */
  it('only takes the ordinary ones as the whole message', () => {
    expect(isAgreement('bet')).toBe(true);
    expect(isAgreement('real')).toBe(true);
    expect(isAgreement('i had a bet on the game')).toBe(false);
    expect(isAgreement('real madrid were awful')).toBe(false);
  });

  it('reads a vote that does not use the word', () => {
    expect(mentionsVoting('locking in blue')).toBe(true);
  });

  // The questions the game asks, and ordinary answers to them, are not
  // accusations. A false positive here puts the seat into a defence nobody
  // started.
  it('does not read an accusation into ordinary chat', () => {
    const ordinary = [
      ...require('../src/game/prompts.json'),
      'pizza',
      'doner kebab',
      'green tea',
      'my nan makes the best one',
      'toast with way too much butter',
      'nothing much, just working a couple of shifts',
    ];
    expect(ordinary.filter((line) => isAccusation(line))).toEqual([]);
  });
});


/*
 * "pink has said like two words all game" is the shape that accusation takes
 * in a real room, and the impostor could neither make it nor see it coming.
 */
describe('who the room has been looking past all match', () => {
  const chatty = [
    { round: 1, name: 'Mr. Blue', text: 'pizza easily' },
    { round: 1, name: 'Mr. Blue', text: 'no way is that better' },
    { round: 1, name: 'Mr. Olive', text: 'doner kebab' },
    { round: 1, name: 'Mr. Olive', text: 'garlic sauce makes it' },
    { round: 1, name: 'Mr. Olive', text: 'you cant be serious' },
    { round: 1, name: 'Mr. Pink', text: 'idk' },
  ];
  const thisRound = [
    { name: 'Mr. Blue', text: 'crisps' },
    { name: 'Mr. Olive', text: 'toast' },
    { name: 'Mr. Olive', text: 'with jam yeah' },
  ];

  it('reads across the rounds, not just this one', () => {
    expect(quietAllMatch({ earlier: chatty, roundLines: thisRound }, 'Mr. Red')).toEqual([
      'Mr. Pink',
    ]);
  });

  /*
   * The same trap the round-level read has a guard for. Early on, the seat
   * with the fewest lines is the seat whose turn has not come round twice,
   * and handing that to a player about to point at somebody is worse than
   * saying nothing.
   */
  it('says nothing until there is enough of a match to judge', () => {
    expect(quietAllMatch({ earlier: [], roundLines: thisRound }, 'Mr. Red')).toEqual([]);
  });

  it('says nothing when everybody has spoken about as much', () => {
    const even = [
      { round: 1, name: 'Mr. Blue', text: 'a' },
      { round: 1, name: 'Mr. Blue', text: 'b' },
      { round: 1, name: 'Mr. Olive', text: 'c' },
      { round: 1, name: 'Mr. Olive', text: 'd' },
      { round: 1, name: 'Mr. Pink', text: 'e' },
      { round: 1, name: 'Mr. Pink', text: 'f' },
      { round: 1, name: 'Mr. Blue', text: 'g' },
      { round: 1, name: 'Mr. Olive', text: 'h' },
    ];
    expect(quietAllMatch({ earlier: even, roundLines: [] }, 'Mr. Red')).toEqual([]);
  });

  it('never counts its own lines against anybody', () => {
    const mine = [...chatty, { round: 1, name: 'Mr. Red', text: 'only me' }];
    expect(quietAllMatch({ earlier: mine, roundLines: thisRound }, 'Mr. Red')).not.toContain(
      'Mr. Red'
    );
  });

  // Both notes are true at once when somebody has been quiet throughout, and
  // printing them together is the same observation twice.
  it('says the match version rather than the round one', () => {
    const note = roomNote(
      { lines: 9, quiet: ['Mr. Pink'], joking: false, swearing: false, arguing: false, suspects: [], piling: false },
      false,
      ['Mr. Pink']
    );
    expect(note).toContain('all game');
    // The round-level sentence, not the words "this round" — the match note
    // contrasts the two on purpose ("not this round, the whole match").
    expect(note).not.toContain('has hardly said anything this round');
  });

  it('falls back to the round when the match has nothing to say', () => {
    const note = roomNote(
      { lines: 9, quiet: ['Mr. Pink'], joking: false, swearing: false, arguing: false, suspects: [], piling: false },
      false,
      []
    );
    expect(note).toContain('this round');
  });

  /*
   * A reason the room will accept. "You have been quiet this round" is one
   * somebody will point out is two messages old.
   */
  it('is the name it turns on when it is cornered', () => {
    const turn = { earlier: chatty, roundLines: thisRound, stillIn: ['Mr. Blue', 'Mr. Olive', 'Mr. Pink'] };
    const read = { quiet: [], names: ['Mr. Blue', 'Mr. Olive', 'Mr. Pink'], suspects: [] };
    const picked = Array.from({ length: 200 }, () =>
      pickCounterTarget(turn, read, [], 'Mr. Red')
    ).filter(Boolean);

    expect(picked.some((one) => one.name === 'Mr. Pink')).toBe(true);
    expect(
      picked.find((one) => one.name === 'Mr. Pink').why
    ).toContain('whole match');
  });
});


/*
 * Reported from a real room: a player said they did not like dogs and
 * preferred cats, and the answer came back "nah, dogs are way better, you
 * just have a bad one". Nobody had said anything about owning a dog.
 */
describe('making things up about the people in the room', () => {
  it('catches a claim about what they have been through', () => {
    for (const line of [
      'nah dogs are way better, you just have a bad one',
      'nah you just havent met the right dog yet lol',
      'you just havent had good calamari',
      'youve clearly never tried it properly',
      'you must have had a bad one',
      'your dog must be badly trained',
      'yours is probably badly trained',
    ]) {
      expect(inventsAboutThem(line)).toBe(true);
    }
  });

  /*
   * Narrow on purpose. The room is full of sentences about "you" and almost
   * all of them are ordinary - disagreeing with somebody is not inventing
   * anything about them, and a message that got caught here would be sent
   * back for a rewrite it did not need.
   */
  it('leaves ordinary disagreement alone', () => {
    for (const line of [
      'nah dogs better',
      'you wrong',
      "youre wrong, dogs are better",
      'how can you not like dogs they are literally the best',
      'you dont like dogs?',
      'you said pizza earlier though',
      'youre missing out honestly',
      'have you seen it?',
      'you have to watch tv, some shows lately are better than books',
    ]) {
      expect(inventsAboutThem(line)).toBe(false);
    }
  });

  // The move it should reach for instead: its own side, which nobody can
  // correct and which is what the rest of the room is doing anyway.
  it('leaves its own side of it alone', () => {
    for (const line of [
      'nah seafood is the best, i love calamari and prawns',
      'i could never have a cat',
      'reading is too much effort for me',
      'i had a bad one once tbh',
    ]) {
      expect(inventsAboutThem(line)).toBe(false);
    }
  });

  it('tells the model so in the standing rules', () => {
    const prompt = systemPrompt(
      { name: 'AI', brief: 'x', traits: [] },
      40,
      null,
      'AI',
      blindSpotsFor('r1')
    );
    expect(prompt).toContain(
      'What you know about the people in this room is what they have typed in it'
    );
    expect(prompt).toContain('you just have a bad one');
  });

  it('says it again on the draw it actually happens on', () => {
    const note = stanceTable({ laterTurn: true }).find(
      (one) => one.key === 'disagree'
    ).note;
    expect(note).toContain('Never a claim about them');
  });

  /*
   * The flag travels with the answer so a round log can show it. Read off the
   * one path that returns without calling the model, because nothing in this
   * suite has a way to stand in for OpenRouter.
   */
  it('reports whether it had to be asked again', async () => {
    const mashing = ['asdkjhasd', 'aslkdjhalskjd', 'askjdhaksjd', 'alskdjhalksjd'].map(
      (text, i) => ({ name: `Mr. ${i}`, text, replyToName: null })
    );
    const result = await writeAnswer({
      roomId: 'r1',
      persona: { name: 'AI', brief: 'x', traits: [] },
      prompt: 'What is your favorite food?',
      answerSeconds: 40,
      roundLines: mashing,
      ownHistory: [],
    });
    expect(result.shape.invented).toBe(false);
  });
});

/**
 * Not arguing against yourself.
 *
 * From a real match (`server/logs/`). It said "my cat", drew `disagree` two
 * turns later into a room of dog people, and wrote "nah dogs are way better,
 * cats are just too moody lol" — against the cat it had claimed to own one
 * minute earlier. Mr. Red: "Then why do you got a cat lol". Mr. Blue: "Yeah,
 * why does you got a cat when you like dogs". Both walked out.
 *
 * The consistency block existed the whole time. It was fed `ownHistory`, which
 * is previous rounds only, so the round it was standing in was the one round
 * it could not see itself in.
 */
describe('what it has already said this round', () => {
  const me = { name: 'AI', brief: 'x', traits: [] };

  const messages = (roundLines, ownHistory = []) =>
    buildMessages({
      ...turn({ roundLines, ownHistory }),
      persona: me,
    })
      .map((message) => message.content)
      .join('\n');

  it('is in front of it when it writes', () => {
    const said = messages([
      { name: 'Mr. Olive', text: 'My dog', replyToName: null },
      { name: 'AI', text: 'my cat', replyToName: null },
      { name: 'Mr. Olive', text: 'Dogs better than cats', replyToName: null },
    ]);

    expect(said).toContain('my cat');
    // Not merely present in the transcript — carried as a thing it said.
    expect(said).toMatch(/- my cat/);
  });

  it('comes after the rounds the room can no longer see', () => {
    const said = messages(
      [{ name: 'AI', text: 'my cat', replyToName: null }],
      ['pepperoni, obviously']
    );

    // Oldest first, so the last entry is the most recent thing it said.
    expect(said.indexOf('pepperoni, obviously')).toBeLessThan(said.indexOf('my cat'));
  });

  it('does not mistake somebody else for itself', () => {
    const said = messages([
      { name: 'Mr. Blue', text: 'Me and Mr silver are team cat lol', replyToName: null },
    ]);

    expect(said).not.toMatch(/- Me and Mr silver are team cat lol/);
  });

  it('tells it that disagreeing never means disagreeing with itself', () => {
    const disagree = STANCES_TALKING.find((option) => option.key === 'disagree');
    expect(disagree.note).toMatch(
      /[Nn]ever disagree with something you yourself have already said/
    );
  });
});
