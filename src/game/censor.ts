/**
 * Swearing and slurs, starred out on the way into the room.
 *
 * Two jobs, and it is worth being clear that they are different.
 *
 * The first is moderation. Strangers are put in a chatroom together with no
 * reporting and no blocking, and the least this can do is refuse to render a
 * slur. That is the reason the list has to be broad rather than tasteful.
 *
 * The second is that swearing is the first test every room lands on.
 * "everyone say fuck, the bot cant do it" is a real message from a real match
 * and it works: a model asked to swear casually mostly will not, and the seat
 * that answers "nah" while four people swear is the seat that gets voted out.
 * Starring everybody's swearing takes the test off the table — `****` is
 * `****` whoever typed it, and whether the impostor complied is not visible.
 *
 * That second half is not finished by this file. A seat whose messages never
 * contain `****` while everybody else's do is the same tell one step removed,
 * so the impostor also has to be willing to swear, which is in the prompt in
 * `server/impostor.js`. This only makes it unverifiable.
 *
 * WHERE: applied where an answer enters the room rather than where it is
 * drawn, so the room only ever holds the starred text. The bubble, the quote
 * above a reply, the transcript, the round log and the facts handed to the
 * impostor are then the same string, and there is no second place to forget.
 * The cost is that what was actually typed is kept nowhere, which is the right
 * trade here and the wrong one for a service that has to action a report.
 *
 * HOW: `obscenity` does the matching. That decision is worth defending,
 * because a hand-written list was the obvious thing and is the wrong thing —
 * not because of the words, which are easy, but because of the obfuscation,
 * which is not. Users type `fvck`, `sh1t`, `@ss`, `F*CK` and `ｆｕｃｋ`, and a
 * filter that reads only letters catches none of them. Getting that right is
 * a confusables table, a leetspeak table and a duplicate collapser, all of
 * which that library already has and maintains. It also means the list of
 * slurs lives in a dependency rather than in this repo.
 *
 * What it does not do well is decide where a word ends, so that part is here.
 */

import {
  DataSet,
  englishDataset,
  englishRecommendedTransformers,
  parseRawPattern,
  RegExpMatcher,
} from 'obscenity';

/**
 * Gaps in the dataset, found by testing it against ordinary inflections.
 *
 * Each entry is the pattern and the word it must catch, and there is a test
 * asserting every pair actually works. That pairing is not ceremony — it is
 * the only thing that catches the trap below.
 *
 * `|` is obscenity's word-boundary assertion, and it is needed: `spic`
 * unbounded sits inside "suspicious".
 *
 * THE TRAP: `englishRecommendedTransformers` collapses repeated letters in the
 * *input* before matching, so a pattern has to be written the way the input
 * will look afterwards, not the way the word is spelled. "trannies" arrives as
 * "tranies", so `|trannies|` is a pattern that can never once fire — it builds
 * without complaint, matches nothing, and looks exactly like coverage. And it
 * is per-letter: "nn" collapses while "oo" and "ss" do not, so `|gooks|` and
 * `|pussies|` are correct as written. Do not guess which; add the pair and let
 * the test tell you.
 */
const ALSO: [pattern: string, mustCatch: string][] = [
  ['|spic|', 'spic'],
  ['|spics|', 'spics'],
  ['|spicks|', 'spicks'],
  ['|wetback|', 'wetback'],
  ['|wetbacks|', 'wetbacks'],
  ['|coon|', 'coon'],
  ['|coons|', 'coons'],
  ['|gooks|', 'gooks'],
  ['|japs|', 'japs'],
  ['|pussies|', 'pussies'],
  ['|dykes|', 'dykes'],
  ['|shat|', 'shat'],
  // Open at the end, so it covers bullshitting/bullshitted/bullshitter.
  ['|bullshit', 'bullshitting'],
  // Collapsed spelling, per the trap above: the input loses one of the n's.
  ['|tranies|', 'trannies'],
  ['|tranie|', 'trannie'],
];

const DATA = ALSO.reduce(
  (set, [raw]) =>
    set.addPhrase((phrase) =>
      phrase.setMetadata({ originalWord: raw }).addPattern(parseRawPattern(raw))
    ),
  new DataSet<{ originalWord: string }>().addAll(englishDataset)
);

const MATCHER = new RegExpMatcher({
  ...DATA.build(),
  ...englishRecommendedTransformers,
});

/**
 * Innocent words the matcher reaches into.
 *
 * The Scunthorpe problem. obscenity word-bounds some of its terms and not
 * others, so `ass` never fires inside "assassin" or "class" — 27 such words
 * come back clean — while `dick`, `cum`, `chink`, `retard` and `pussy` fire
 * happily inside "Dickinson", "cumin", "chinkapin", "retardant" and
 * "pussycat".
 *
 * An affix rule was tried here first and reverted, and it is worth saying why
 * so it is not tried again: only starring a match whose surroundings are an
 * ending a swear takes ("fuck" + "ing", yes; "dick" + "inson", no) fixes eight
 * of these — and silently stops catching "shitty", "faggot" and "trannies",
 * because those are also a stem plus an ending no rule would allow. Nothing
 * structural separates "shitty" from "cockpit". It takes knowing what the
 * words mean, so the list is a list.
 *
 * Which sets the direction of failure: an unknown innocent word gets starred,
 * rather than an unknown slur getting through. Every entry below was produced
 * by running the thing over ordinary English, not by imagining it.
 */
const EXEMPT = new Set([
  // Reached into by `cock`.
  'cockpit',
  'cockpits',
  'cocktail',
  'cocktails',
  // By `shit`. Food comes up constantly here; half the prompts are about it.
  'shiitake',
  'shiitakes',
  // By `cum`.
  'cumin',
  'cumins',
  // By `dick`.
  'dickinson',
  'dicky',
  'dickie',
  'dickies',
  // By `chink`.
  'chinkapin',
  'chinkapins',
  // By `retard`.
  'retardant',
  'retardants',
  'retardation',
  // By `pussy`.
  'pussycat',
  'pussycats',
  // Place names, which is where this problem got its name.
  'scunthorpe',
  'penistone',
  'clitheroe',
]);

/**
 * Left starred on purpose, where no list can help.
 *
 * `chink`, `pussy`, `dyke`, `faggot` and `retarded` are each a slur and,
 * separately, an ordinary word — a gap in armour, a plant, an embankment, a
 * plate of offal, a delayed process. Nothing available here can tell which one
 * a stranger meant, so they stay starred, and "a chink in the armour" comes
 * out as "a ***** in the armour".
 *
 * That is the right way round. Masking the idiom makes one message read
 * oddly; not masking it renders a slur at somebody who then has no way to
 * report it. Written down so the next person does not "fix" it.
 */

const WORD = /[\p{L}\p{N}]/u;

/** The whole word a match sits inside, so `fucking` stars completely. */
function wordAround(text: string, from: number, to: number) {
  let start = from;
  let end = to;

  while (start > 0 && WORD.test(text[start - 1])) start -= 1;
  while (end < text.length - 1 && WORD.test(text[end + 1])) end += 1;

  return { start, end };
}

/**
 * Letters spaced out to walk past the filter: "f u c k", "n i g g e r".
 *
 * Handled separately rather than by stripping whitespace before matching,
 * because stripping it turns "a class" into "aclass" and loses every word
 * boundary in the message — which trades this hole for a much worse one. So
 * only runs that are *nothing but* single letters are collapsed, and only the
 * run itself is tested and starred.
 */
const SPACED = /(?:[\p{L}\p{N}][^\p{L}\p{N}]+){2,}[\p{L}\p{N}](?![\p{L}\p{N}])/gu;

function starRanges(text: string) {
  const ranges: { start: number; end: number }[] = [];

  for (const match of MATCHER.getAllMatches(text)) {
    const { start, end } = wordAround(text, match.startIndex, match.endIndex);
    const word = text.slice(start, end + 1).toLowerCase();

    if (EXEMPT.has(word)) continue;

    ranges.push({ start, end });
  }

  for (const spaced of text.matchAll(SPACED)) {
    const run = spaced[0];
    const collapsed = [...run].filter((char) => WORD.test(char)).join('');

    // Only if the letters actually spell something. "i a m o k" spells
    // nothing and is left alone.
    if (!MATCHER.hasMatch(collapsed)) continue;

    ranges.push({
      start: spaced.index,
      end: spaced.index + run.length - 1,
    });
  }

  return ranges;
}

/**
 * The message as the room sees it.
 *
 * Stars match the length of what they replace, whole word at a time. Whole
 * word matters: obscenity on its own returns `bull****` and `****ing`, which
 * leaves the shape of the sentence intact and reads like a redaction. People
 * are used to the entire word going.
 */
export function censor(text: string): string {
  if (!text) return text;

  const ranges = starRanges(text);

  if (ranges.length === 0) return text;

  const out = [...text];

  for (const { start, end } of ranges) {
    for (let i = start; i <= end && i < out.length; i++) out[i] = '*';
  }

  return out.join('');
}

/**
 * The added patterns and the words they exist to catch.
 *
 * Exported for the test that asserts each one fires, which is the guard
 * against a pattern that builds cleanly and matches nothing.
 */
export const ADDED_TERMS: readonly [pattern: string, mustCatch: string][] = ALSO;

/** Whether the room would star any of this. */
export function hasProfanity(text: string): boolean {
  return starRanges(text).length > 0;
}
