import { SEAT_COLOURS, seatColours, seatName, textOnTint } from './seats';

describe('the pool', () => {
  it('has no two colours with the same name', () => {
    const names = SEAT_COLOURS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('has no two colours with the same tint, which would make the names a lie', () => {
    const tints = SEAT_COLOURS.map((c) => c.tint);
    expect(new Set(tints).size).toBe(tints.length);
  });

  it('is comfortably bigger than a room, so a colour is never a fixture', () => {
    expect(SEAT_COLOURS.length).toBeGreaterThanOrEqual(12);
  });
});

describe('dealing a room', () => {
  it('never deals the same colour twice', () => {
    // Every room size the pool claims to serve, over many rooms: a duplicate
    // breaks voting, the transcript and the impostor's reading of the room at
    // once, so "unlikely" is not the bar.
    for (let seats = 2; seats <= SEAT_COLOURS.length; seats++) {
      for (let i = 0; i < 500; i++) {
        const drawn = seatColours(`rm_${i.toString(36)}`, seats);
        expect(new Set(drawn.map((c) => c.name)).size).toBe(seats);
      }
    }
  });

  it('deals the same room the same colours every time it is asked', () => {
    // The whole reason it is seeded: nothing stores this, so every part of the
    // system has to independently arrive at the same answer.
    const once = seatColours('rm_stable', 5).map((c) => c.name);
    const twice = seatColours('rm_stable', 5).map((c) => c.name);
    expect(twice).toEqual(once);
  });

  it('deals different rooms different colours', () => {
    const rooms = Array.from({ length: 200 }, (_, i) =>
      seatColours(`rm_${i.toString(36)}`, 5).map((c) => c.name).join(',')
    );
    // Not a uniqueness claim — 200 rooms out of a small pool will collide.
    // The claim is only that it is not handing every room one fixed answer.
    expect(new Set(rooms).size).toBeGreaterThan(50);
  });

  it('puts every colour to work rather than favouring the front of the pool', () => {
    // The bug this is here for: a draw that walks the pool in fixed strides
    // only reaches every entry when the stride is coprime with the pool size,
    // and silently visits two colours forever when it is not.
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      for (const colour of seatColours(`rm_${i.toString(36)}`, 5)) seen.add(colour.name);
    }
    expect(seen.size).toBe(SEAT_COLOURS.length);
  });

  it('deals every colour about equally often', () => {
    /*
     * The test that matters, and the one "every colour appears at least once"
     * was not. The first generator here was a one-line LCG, whose low bits are
     * its worst - and Fisher-Yates reads exactly those, via `% (i + 1)`. It
     * passed coverage while dealing one colour 18 times in 20,000 rooms and
     * three of them 1.65x too often. A colour that rare, or that common, is a
     * colour the room can start reading something into.
     */
    const rooms = 20000;
    const seats = 5;
    const counts = new Map(SEAT_COLOURS.map((c) => [c.name, 0]));

    for (let i = 0; i < rooms; i++) {
      for (const colour of seatColours(`rm_${i.toString(36)}`, seats)) {
        counts.set(colour.name, (counts.get(colour.name) ?? 0) + 1);
      }
    }

    const expected = (rooms * seats) / SEAT_COLOURS.length;
    for (const [name, count] of counts) {
      // Generous, because this is catching a broken generator rather than
      // measuring randomness — the LCG missed by 400x, not by 10%.
      expect({ name, off: Math.abs(count - expected) / expected < 0.1 }).toEqual({
        name,
        off: true,
      });
    }
  });

  it('refuses to seat a room bigger than the pool instead of repeating', () => {
    expect(() => seatColours('rm_big', SEAT_COLOURS.length + 1)).toThrow(/pool/);
  });
});

describe('the name', () => {
  it('is Mr. for everybody, because a per-player attribute is a thing to test', () => {
    expect(SEAT_COLOURS.every((c) => seatName(c).startsWith('Mr. '))).toBe(true);
  });

  it('reads as a name rather than a label', () => {
    expect(seatName({ name: 'Pink', tint: '#000000' })).toBe('Mr. Pink');
  });
});

describe('the colour words', () => {
  /*
   * There used to be a rule here that no two colours could share their first
   * two letters, because the avatar rendered those two letters and Green and
   * Grey both gave GR. The avatar is a picture now, so that rule has no
   * consumer and is gone rather than left standing as a live-looking
   * constraint — it is why Grey became Silver and why Blonde was kept out, and
   * both of those are free to come back.
   *
   * What still has to hold is that the words are distinct, since the room
   * types them at each other.
   */
  it('is a set of distinct single words', () => {
    const names = SEAT_COLOURS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.every((n) => /^[A-Z][a-z]+$/.test(n))).toBe(true);
  });
});

describe('the tints', () => {
  /*
   * The tint is the author's name in the answer bubble, not only a swatch, so
   * a colour that is pleasant and unreadable is a bug. 3.5:1 is this app's own
   * floor — `Colors.textMuted` sits there — and it is asserted here rather
   * than trusted, because darkening the palette is exactly the kind of change
   * that gets made by eye on one bright screen.
   */
  const BACKGROUND = '#0a0b0f';

  function luminance(hex: string) {
    const channel = (i: number) => {
      const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  }

  function contrast(hex: string) {
    const a = luminance(hex);
    const b = luminance(BACKGROUND);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  it('stays readable on the background it is drawn against', () => {
    for (const colour of SEAT_COLOURS) {
      expect({ name: colour.name, readable: contrast(colour.tint) >= 3.5 }).toEqual({
        name: colour.name,
        readable: true,
      });
    }
  });

  it('is written as a six-digit hex, since the avatar appends an alpha pair', () => {
    // `Avatar` builds its fill as `tint + '2E'`. A shorthand or named colour
    // would silently produce nonsense rather than fail.
    expect(SEAT_COLOURS.every((c) => /^#[0-9a-f]{6}$/.test(c.tint))).toBe(true);
  });
});

describe('text on a seat colour', () => {
  /*
   * Your own answers are drawn on your own tint. A single text colour cannot
   * serve fifteen backgrounds — white on Yellow measures 2.4:1 — so the choice
   * is made by measuring, and this is the check that it actually was.
   */
  function luminance(hex: string) {
    const channel = (i: number) => {
      const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
  }

  function contrast(a: string, b: string) {
    const [x, y] = [luminance(a), luminance(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  it('picks the more readable of the two on every colour', () => {
    for (const colour of SEAT_COLOURS) {
      const chosen = textOnTint(colour.tint);
      const other = chosen === '#ffffff' ? '#0a0b0f' : '#ffffff';
      expect({
        name: colour.name,
        better: contrast(chosen, colour.tint) >= contrast(other, colour.tint),
      }).toEqual({ name: colour.name, better: true });
    }
  });

  it('clears 4.5:1 on every colour, so no seat gets an unreadable bubble', () => {
    for (const colour of SEAT_COLOURS) {
      expect({
        name: colour.name,
        readable: contrast(textOnTint(colour.tint), colour.tint) >= 4.5,
      }).toEqual({ name: colour.name, readable: true });
    }
  });

  it('does not answer the same thing for everything, which is the bug it replaces', () => {
    // Deliberately not a list of which colours take ink: that list moves
    // whenever a tint is adjusted by a couple of percent, and pinning it turns
    // an ordinary palette tweak into a failing test about nothing. What has to
    // hold is that the function actually discriminates.
    const inked = SEAT_COLOURS.filter((c) => textOnTint(c.tint) === '#0a0b0f');
    const white = SEAT_COLOURS.filter((c) => textOnTint(c.tint) === '#ffffff');

    expect(inked.length).toBeGreaterThan(0);
    expect(white.length).toBeGreaterThan(0);
    expect(inked.length + white.length).toBe(SEAT_COLOURS.length);
  });
});
