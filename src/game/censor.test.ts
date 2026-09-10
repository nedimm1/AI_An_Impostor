/**
 * The starring, and mostly the words it must not touch.
 *
 * The words it *should* star are `obscenity`'s problem and it has its own
 * tests for them; what is tested here is the part this app added — whole-word
 * masking, the exception list, and the spaced-letter hole — plus a couple of
 * live rounds through the real matcher so that a dependency bump which quietly
 * stops catching things fails here.
 *
 * The false positives are the interesting half. A filter that misses a swear
 * costs the impostor a little cover; a filter that stars "Arsenal" in a room
 * talking about football is a bug everybody sees, and a room did talk about
 * Arsenal while this was being built.
 */

import { ADDED_TERMS, censor, hasProfanity } from './censor';

describe('starring out swearing', () => {
  it('stars the word and leaves the sentence', () => {
    expect(censor('fuck this')).toBe('**** this');
    expect(censor('what the fuck is that')).toBe('what the **** is that');
    expect(censor('piss off')).toBe('**** off');
  });

  it('stars the whole word, not just the rude part of it', () => {
    // obscenity on its own returns "****ing" and "bull****", which leaves the
    // shape of the sentence intact and reads like a redaction.
    expect(censor('fucking')).toBe('*******');
    expect(censor('thats bullshit')).toBe('thats ********');
    expect(censor('what a dickhead')).toBe('what a ********');
  });

  it('does not care about case', () => {
    expect(censor('SHIT')).toBe('****');
    expect(censor('Fuck')).toBe('****');
  });

  it('sees through the usual ways round a filter', () => {
    // The reason this is a dependency and not a word list: none of these are
    // caught by anything that only reads letters.
    for (const dodge of ['fvck', 'sh1t', 'F*CK', 'ｆｕｃｋ', 'b1tch', 'fuuuck', 'shiiiit']) {
      expect(hasProfanity(dodge)).toBe(true);
    }
  });

  it('sees letters spaced out', () => {
    // The obvious way past a filter, and the one that matters most for slurs.
    expect(censor('f u c k this')).toBe('******* this');
    expect(hasProfanity('n i g g e r')).toBe(true);
  });

  it('actually fires every pattern this app added', () => {
    /*
     * The guard against a pattern that builds cleanly and matches nothing.
     *
     * `englishRecommendedTransformers` collapses repeated letters in the input
     * before matching, so a pattern has to be spelled the way the input will
     * look afterwards. `|trannies|` never fires, because the text arrives as
     * "tranies" - and it is per-letter, so "oo" and "ss" survive while "nn"
     * and "tt" do not. Nothing about that is visible at the call site, which
     * is why each pattern is paired with a word and checked here.
     */
    for (const [source, mustCatch] of ADDED_TERMS) {
      expect(hasProfanity(mustCatch)).toBe(true);
      expect(source).toBeTruthy();
    }
  });

  it('stars ordinary inflections, not just the bare word', () => {
    for (const inflected of [
      'shitty',
      'faggots',
      'trannies',
      'niggers',
      'bullshitting',
      'fuckers',
      'motherfuckers',
      'bitches',
      'wankers',
    ]) {
      expect(hasProfanity(inflected)).toBe(true);
    }
  });

  it('stars slurs, including obfuscated ones', () => {
    // Representative rather than exhaustive - the list itself lives in the
    // dependency, which is most of the point of using one.
    for (const slur of ['n1gger', 'f4ggot', 'r3tard', 'tr4nny', 'k1ke', 'spic', 'wetback']) {
      expect(hasProfanity(slur)).toBe(true);
    }
  });

  it('leaves innocent words alone', () => {
    // Scunthorpe is the famous one. Arsenal came up in a real round.
    for (const safe of [
      'Scunthorpe',
      'Arsenal',
      'i support arsenal',
      'assassin',
      'class',
      'pass the salt',
      'bass guitar',
      'massive',
      'peacock',
      'Dickens',
      'cucumber',
      'document',
      'circumstance',
      'titanium',
      'title',
      'analysis',
      'grass',
      'glasses',
      'compass',
      'embarrassing',
      'constitution',
      'therapist',
      'specialist',
      'attack on titan',
    ]) {
      expect(censor(safe)).toBe(safe);
    }
  });

  it('leaves the words the matcher reaches into by accident', () => {
    // Measured, not imagined: every one of these came back starred.
    for (const innocent of [
      'cockpit',
      'a cocktail',
      'shiitake mushrooms',
      'cumin',
      'Dickinson',
      'flame retardant',
      'retardation',
      'pussycat',
      'chinkapin',
      'Scunthorpe',
    ]) {
      expect(censor(innocent)).toBe(innocent);
    }
  });

  it('stars the ambiguous ones anyway, which is deliberate', () => {
    /*
     * "chink", "pussy", "dyke", "faggot" and "retarded" are each a slur and,
     * separately, an ordinary word. Nothing here can tell which a stranger
     * meant, so they stay starred: masking the idiom makes one message read
     * oddly, and not masking it renders a slur at somebody who cannot report
     * it. Asserted so the trade is a decision rather than a surprise.
     */
    expect(censor('a chink in the armour')).toBe('a ***** in the armour');
    expect(censor('pussy willow')).toBe('***** willow');
  });

  it('does not read initials as an attempt to dodge it', () => {
    // The spaced-letter rule only fires when the letters spell something.
    expect(censor('i a m o k')).toBe('i a m o k');
    expect(censor('a b c d e f')).toBe('a b c d e f');
  });

  it('leaves the mild ones, which a model types without hesitating', () => {
    for (const mild of ['damn it', 'crap', 'what the hell', 'hello']) {
      expect(censor(mild)).toBe(mild);
    }
  });

  it('copes with nothing', () => {
    expect(censor('')).toBe('');
    expect(censor('pepperoni, keep it simple tbh')).toBe('pepperoni, keep it simple tbh');
  });

  it('says whether it would star anything', () => {
    expect(hasProfanity('fuck this')).toBe(true);
    expect(hasProfanity('i support arsenal')).toBe(false);
  });
});
