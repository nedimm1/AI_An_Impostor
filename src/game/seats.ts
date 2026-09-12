/**
 * What the room calls you, and where it comes from.
 *
 * Nobody types a name. Every seat is handed one when the room is seated, and
 * it lasts exactly one match.
 *
 * THREE REASONS, in the order they matter.
 *
 * It closes an impostor tell. The model's seat used to be named by the same
 * curated list the stand-ins drew from while every human typed their own, so
 * the two populations looked different before a word was written: real people
 * produce `jess`, `738`, `ur mum`, `xX_dark_Xx`, and a list produces `Mara`.
 * A room that learns the naming distribution learns which seat is the bot. One
 * pool for every seat, drawn one way, and there is nothing left to learn. This
 * is the reason a name can never go back to being typed: it is the one label
 * on screen every round of the match, so being slightly wrong about it is not
 * a lost turn, it is a lost match, and there is no second draw.
 *
 * It stops the room recognising you. The game seats strangers, and two players
 * who met last match knowing it - "played with him yesterday, he was straight"
 * - is a fact about a previous room deciding this one. Colours are reused
 * constantly and mean nothing, which is the point: the seat called Pink today
 * is not the one from your last game, and everybody knows it.
 *
 * It deletes the profanity surface rather than filtering it. A typed name is
 * free text shown to strangers, and `censor.ts` never saw it - it is applied
 * to answers on the way into the room (`reducer.ts`) and to nothing else. The
 * fix is not a second filter to beat. It is having no free text.
 *
 * WHY COLOURS. The label must not bias the vote. Animals were the tempting
 * option - a bigger pool and far more personality - but Crow and Fox read as
 * sneaky and would draw votes on the name alone, which is noise in the only
 * mechanic the game has. No colour sounds guilty. Colours also carry a tint,
 * so the label is a UI primitive as well as a word, which is what Among Us
 * gets out of them: players there say "red was acting sus" and never use the
 * username sitting right next to it.
 *
 * WHY "MR." FOR EVERYONE. Reservoir Dogs, where the colours exist so a crew of
 * strangers cannot identify each other - the same job they are doing here. It
 * is uniform deliberately. Asking which honorific somebody wants would put the
 * one durable fact about a player into a room built to learn nothing about
 * them, and would hand the room a test to run: a per-player attribute the
 * model does not really have is an attack surface, the same way swearing is
 * (see the note in `censor.ts`). Everybody is Mr. Nothing is learnable.
 */

/**
 * The pool.
 *
 * Every pair has to be unmistakable from every other pair, because the draw is
 * random and cannot be trusted to keep the confusable ones apart. So the work
 * happens here rather than in the draw: no Rose beside Red, no Amber beside
 * Orange, no Beige beside Tan. Every entry is one short common word that reads
 * the same out loud as it does on screen, and the words carry the distinction
 * even where the hues are neighbours - Blue and Violet are close to look at and
 * impossible to mix up to read, which is the way round that matters when the
 * label is text first and a tint second.
 *
 * The grey one is Silver for a reason that a test now holds in place: "Grey"
 * and "Green" share their first two letters, so they render as the same avatar
 * letters - and they are the same word to a room half-reading it at speed.
 *
 * Cyan is 2% darker than it looks like it should be. Mid-luminance is the hard
 * case for a colour that has to carry text: at its natural depth neither white
 * nor ink cleared 4.5:1 on it. Two percent buys the margin, and a test holds
 * it. (Teal had the same problem and the same fix, before it was cut for
 * sitting too close to Green.)
 *
 * Fifteen for six seats. The pool has to be comfortably bigger than the room
 * or a colour turns up every match and starts meaning something, which is the
 * cross-match recognition this exists to remove, one level down.
 *
 * Gold is on the end for how it sounds rather than for a hue the list was
 * missing - every seat is read as "Mr. Something" all match, and the film the
 * honorific comes from got a lot out of that.
 *
 * Twelve, not fifteen. Teal, Crimson and Indigo were cut for being too close to
 * something already here - measured as CIE76 distance, Red/Crimson came out at
 * 13.5 and Green/Teal at 19.4, while Indigo sat between Blue and Violet and was
 * the cause of the two tightest pairs in the pool at 13.2 and 11.2. The gap to
 * beat is now Yellow/Gold at 16.5; anything added should clear that.
 *
 * `tint` is the bubble and the avatar dot - and, in the answer bubble, the
 * author's name itself, which is why these are not free to be any depth that
 * looks nice. They are set as dark as they go while still clearing 3.5:1
 * against `Colors.background`, which is the floor this app already works to:
 * `textMuted` sits at 3.5 and `accent` at 4.6, so anything dimmer than that is
 * dimmer than text the app already considers readable.
 *
 * Most land at about 0.81 of their old value. Blue and Violet barely move,
 * because those hues are already near the floor at full saturation - there is
 * no depth left in them to take.
 *
 * Black and White stay absent: one of them always disappears into the
 * background.
 */
export type SeatColour = {
  /** The word. Capitalised, because it is a name. */
  name: string;
  tint: string;
};

export const SEAT_COLOURS: SeatColour[] = [
  { name: 'Red', tint: '#b93a3e' },
  { name: 'Orange', tint: '#c85711' },
  { name: 'Yellow', tint: '#cfa031' },
  { name: 'Olive', tint: '#728400' },
  { name: 'Green', tint: '#278557' },
  { name: 'Cyan', tint: '#00809e' },
  { name: 'Blue', tint: '#3c5fd4' },
  { name: 'Violet', tint: '#884bbe' },
  { name: 'Pink', tint: '#b43686' },
  { name: 'Brown', tint: '#8c6747' },
  { name: 'Silver', tint: '#7e8286' },
  { name: 'Gold', tint: '#b08535' },
];

/** Everybody, every match. See the note above for why it is not a choice. */
const HONORIFIC = 'Mr.';

/** `Pink` -> `Mr. Pink`. The only place the two are joined. */
export function seatName(colour: SeatColour) {
  return `${HONORIFIC} ${colour.name}`;
}

/**
 * What to write on a seat's colour.
 *
 * Your own answers are drawn on your own tint, and a single text colour cannot
 * serve fifteen backgrounds. White on Yellow measures 2.4:1 - unreadable - and
 * on Gold and Silver it is not much better, while on Blue or Red white is the
 * only thing that works. So the choice is made per colour, by measuring:
 * whichever of white or the page ink stands further off that tint wins.
 *
 * Six of the fifteen come out ink rather than white, which is why this is a
 * function and not a constant somebody picked by looking at one bubble.
 */
const ON_LIGHT = '#0a0b0f';
const ON_DARK = '#ffffff';

/** Relative luminance, WCAG. */
function luminance(hex: string) {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: number, b: number) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function textOnTint(tint: string) {
  // Both candidates measured through the same function rather than one of them
  // standing in as a rounded constant — at 0.0045 instead of its real 0.0034,
  // Cyan came out white when the measurement says ink, which is precisely the
  // borderline case a constant is no use for.
  const l = luminance(tint);

  return contrast(l, luminance(ON_DARK)) >= contrast(l, luminance(ON_LIGHT))
    ? ON_DARK
    : ON_LIGHT;
}

/**
 * "Mr. Pink" -> "Pink".
 *
 * For the vote strip, where every chip is 52px wide and every name starts with
 * the same four characters. "Mr. Violet" truncates to "Mr. Viol…" there, which
 * spends the width on the part carrying no information and clips the part
 * carrying all of it. In a list where everybody is a Mr., nobody is.
 */
export function seatShortName(name: string) {
  return String(name).replace(/^\S+\.\s*/, '');
}

/**
 * The room id, as a number.
 *
 * Same shape as `bitFor` on the server, and for the same reason: seeding off
 * the room means no state and no plumbing, and every part of the system that
 * needs to know who is called what independently arrives at the same answer.
 */
function hash(seed: string) {
  let value = 0;
  for (const char of seed) {
    value = (value * 131 + char.charCodeAt(0)) | 0;
  }
  return Math.abs(value);
}

/**
 * Colours for one room, in seat order, without repeats.
 *
 * A seeded Fisher-Yates, which is correct at any pool size - unlike walking
 * the pool in fixed strides, which only visits every entry when the stride is
 * coprime with the pool size, a property of a number nobody re-checks the day
 * a colour is added.
 *
 * The generator underneath it is `mulberry32` and not the one-line LCG that
 * was here first. That matters more than it sounds. Fisher-Yates asks for
 * `random % (i + 1)`, which reads the *low* bits, and the low bits of an LCG
 * are its worst ones - they cycle with a period of a handful. Measured over
 * 20,000 rooms of five seats against a flat expectation of 7,692 a colour:
 * one colour came up 18 times and three came up ~12,700. One seat colour was
 * effectively never dealt and three were dealt at 1.65x, which is exactly the
 * "a colour starts meaning something" failure the pool size is chosen to
 * avoid, arriving through the draw instead. Same measurement on this
 * generator: 7,557 to 7,934, flat.
 *
 * Asking for more seats than the pool holds throws rather than repeating a
 * colour. Two seats with one name breaks voting, the transcript and the
 * impostor's reading of the room all at once, so it must be impossible rather
 * than unlikely.
 */
export function seatColours(roomId: string, count: number): SeatColour[] {
  if (count > SEAT_COLOURS.length) {
    throw new Error(
      `${count} seats but only ${SEAT_COLOURS.length} colours - the pool has to grow before the room does`
    );
  }

  // mulberry32. Returns a fraction of the whole 32-bit state rather than a
  // remainder of it, so the choice never rests on the low bits alone.
  let state = hash(roomId) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const pool = [...SEAT_COLOURS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  return pool.slice(0, count);
}
