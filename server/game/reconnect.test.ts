/**
 * Losing the connection and coming back: the grace period, and what happens to
 * things a phone held while it was away.
 */

import { momentOf } from '../../src/game/protocol';
import { currentTurnId } from '../../src/game/types';

import { Lobby, type LobbyEvents } from './lobby';
import { Match, type ImpostorModel } from './match';

const quietModel: ImpostorModel = { answer: async () => null, vote: async () => null };
const person = (n: number) => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`;

const GRACE = 90_000;

function duel() {
  const matches = new Set<Match>();
  const events: LobbyEvents = {
    matchChanged: (m) => matches.add(m),
    queueChanged: () => {},
    leftQueue: () => {},
    matchEnded: (m) => matches.delete(m),
  };
  const lobby = new Lobby(quietModel, events, GRACE);
  lobby.join(person(1), 3);
  lobby.join(person(2), 3);
  const match = [...matches][0];
  return { lobby, match, matches };
}

function cleanUp(matches: Set<Match>) {
  for (const m of [...matches]) m.players().forEach((id) => m.leave(id));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('a dropped connection', () => {
  it('keeps the seat while the phone is gone for less than the grace period', () => {
    const { lobby, match, matches } = duel();
    lobby.disconnected(person(1));
    jest.advanceTimersByTime(GRACE - 1_000);
    lobby.reconnected(person(1));
    // Past where the removal would have happened — not so far that the match
    // plays itself out on the clock and closes, which would prove nothing.
    jest.advanceTimersByTime(GRACE);

    expect(lobby.matchFor(person(1))).toBe(match);
    expect(match.has(person(1))).toBe(true);
    cleanUp(matches);
  });

  it('lets the match carry on without somebody gone for longer than that', () => {
    const { lobby, match, matches } = duel();
    lobby.disconnected(person(1));
    jest.advanceTimersByTime(GRACE);

    expect(lobby.matchFor(person(1))).toBeNull();
    expect(match.has(person(1))).toBe(false);
    // They are shown as having left, like anybody who walked out.
    const seat = match.view(person(2)).players.find((p) => !p.connected);
    expect(seat).toBeDefined();
    cleanUp(matches);
  });

  it('tells them why when they come back, and only once', () => {
    const { lobby, matches } = duel();
    lobby.disconnected(person(1));
    jest.advanceTimersByTime(GRACE);

    expect(lobby.reconnected(person(1))).toBe(true);
    expect(lobby.reconnected(person(1))).toBe(false);
    cleanUp(matches);
  });

  it('does not count a reconnect-then-drop as one long absence', () => {
    // Two short drops a minute apart are two short drops, not ninety seconds.
    const { lobby, match, matches } = duel();
    lobby.disconnected(person(1));
    jest.advanceTimersByTime(60_000);
    lobby.reconnected(person(1));
    lobby.disconnected(person(1));
    jest.advanceTimersByTime(60_000);

    expect(match.has(person(1))).toBe(true);
    cleanUp(matches);
  });

  it('takes a queued player out of the queue straight away', () => {
    const events: LobbyEvents = {
      matchChanged: () => {},
      queueChanged: () => {},
      leftQueue: () => {},
      matchEnded: () => {},
    };
    const lobby = new Lobby(quietModel, events, GRACE);
    lobby.join(person(1), 5);
    lobby.disconnected(person(1));
    expect(lobby.queuedFor(person(1))).toBeNull();
  });
});

describe('what a phone held while it was away', () => {
  it('lands an answer stamped with the moment it is still in', () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { match, matches } = duel();
      const turnSeat = currentTurnId(match.view(person(1)));
      const onTurn = [person(1), person(2)].find((p) => match.view(p).youId === turnSeat);
      if (!onTurn) {
        cleanUp(matches);
        continue;
      }

      const now = momentOf(match.view(onTurn));
      match.handle(onTurn, { type: 'answer', text: 'on time', timedOut: false, replyToId: null }, now);
      expect(match.view(onTurn).transcript.map((a) => a.text)).toEqual(['on time']);
      cleanUp(matches);
      return;
    }
    throw new Error('no duel opened on a person’s turn in 100 draws');
  });

  it('drops an answer stamped for a moment that has passed', () => {
    // The case this exists for: typed on your turn in one lap, held through a
    // dropped connection, and arriving on your turn in the next.
    for (let attempt = 0; attempt < 100; attempt++) {
      const { match, matches } = duel();
      const turnSeat = currentTurnId(match.view(person(1)));
      const onTurn = [person(1), person(2)].find((p) => match.view(p).youId === turnSeat);
      if (!onTurn) {
        cleanUp(matches);
        continue;
      }

      const stale = momentOf({ ...match.view(onTurn), turnIndex: 99 });
      match.handle(onTurn, { type: 'answer', text: 'too late', timedOut: false, replyToId: null }, stale);
      expect(match.view(onTurn).transcript).toHaveLength(0);
      cleanUp(matches);
      return;
    }
    throw new Error('no duel opened on a person’s turn in 100 draws');
  });

  it('still lets you leave, whatever moment it was sent from', () => {
    const { lobby, match, matches } = duel();
    match.handle(person(1), { type: 'leave' }, 'some:long:gone:moment');
    expect(match.has(person(1))).toBe(false);
    lobby.leaveMatch(person(1));
    cleanUp(matches);
  });
});

describe('a seat whose connection is down', () => {
  /** A duel that opens on a person's turn, and which person that is. */
  function duelOnAPersonsTurn() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const d = duel();
      const turnSeat = currentTurnId(d.match.view(person(1)));
      const speaker = [person(1), person(2)].find((p) => d.match.view(p).youId === turnSeat);
      if (speaker) {
        const other = speaker === person(1) ? person(2) : person(1);
        return { ...d, speaker, other };
      }
      cleanUp(d.matches);
    }
    throw new Error('no duel opened on a person’s turn in 100 draws');
  }

  const TURN_AND_GRACE = 40_000 + 1_000;

  it('shows everyone a countdown on that seat, and takes it away when they are back', () => {
    const { lobby, match, matches } = duel();
    const seat = match.view(person(1)).youId;

    lobby.disconnected(person(1));
    const away = match.view(person(2)).players.find((p) => p.id === seat)!;
    expect(away.awayUntil).toBe(Date.now() + GRACE);

    lobby.reconnected(person(1));
    expect(match.view(person(2)).players.find((p) => p.id === seat)!.awayUntil).toBeNull();
    cleanUp(matches);
  });

  it('puts what they had typed in the room when their turn runs out while they are gone', () => {
    const { lobby, match, matches, speaker } = duelOnAPersonsTurn();
    match.draft(speaker, 'i was halfway through say', momentOf(match.view(speaker)));
    lobby.disconnected(speaker);
    jest.advanceTimersByTime(TURN_AND_GRACE);

    const [answer] = match.view(speaker).transcript;
    expect(answer.text).toBe('i was halfway through say');
    expect(answer.timedOut).toBe(false);
    expect(answer.lostConnection).toBe(true);
    cleanUp(matches);
  });

  it('says they lost connection when they had typed nothing', () => {
    const { lobby, match, matches, speaker } = duelOnAPersonsTurn();
    lobby.disconnected(speaker);
    jest.advanceTimersByTime(TURN_AND_GRACE);

    const [answer] = match.view(speaker).transcript;
    expect(answer.text).toBe('');
    expect(answer.timedOut).toBe(true);
    expect(answer.lostConnection).toBe(true);
    cleanUp(matches);
  });

  it('keeps an ordinary running-out-of-time as that, for somebody still connected', () => {
    const { match, matches, speaker } = duelOnAPersonsTurn();
    match.draft(speaker, 'never sent', momentOf(match.view(speaker)));
    jest.advanceTimersByTime(TURN_AND_GRACE);

    const [answer] = match.view(speaker).transcript;
    // Connected, their own phone would have sent the draft itself; reaching the
    // clock means it did not, and that is not a lost connection.
    expect(answer.timedOut).toBe(true);
    expect(answer.lostConnection).toBeUndefined();
    cleanUp(matches);
  });

  it('posts their draft before removing them, if they are removed on their own turn', () => {
    // 25 seconds is shorter than a 40-second turn, so this is the usual case.
    const { lobby, match, matches, speaker } = duelOnAPersonsTurn();
    match.draft(speaker, 'my wifi is', momentOf(match.view(speaker)));
    lobby.disconnected(speaker);
    jest.advanceTimersByTime(GRACE);

    const posted = match.view(speaker).transcript.find((a) => a.lostConnection);
    expect(posted?.text).toBe('my wifi is');
    expect(match.has(speaker)).toBe(false);
    cleanUp(matches);
  });

  it('never shows anybody what somebody is still typing', () => {
    const { match, matches, speaker, other } = duelOnAPersonsTurn();
    match.draft(speaker, 'a secret half sentence', momentOf(match.view(speaker)));
    expect(JSON.stringify(match.view(other))).not.toContain('a secret half sentence');
    expect(JSON.stringify(match.view(speaker))).not.toContain('a secret half sentence');
    cleanUp(matches);
  });

  it('ignores typing from somebody whose turn it is not', () => {
    const { lobby, match, matches, other } = duelOnAPersonsTurn();
    // `other` is not on the clock; their "draft" is not an answer in progress.
    match.draft(other, 'not my turn', momentOf(match.view(other)));
    lobby.disconnected(other);
    jest.advanceTimersByTime(TURN_AND_GRACE);
    expect(JSON.stringify(match.view(other).transcript)).not.toContain('not my turn');
    cleanUp(matches);
  });
});

describe('saying why somebody is gone', () => {
  it('says they disconnected when the match carried on without them', () => {
    const { lobby, match, matches } = duel();
    const seat = match.view(person(1)).youId;
    lobby.disconnected(person(1));
    jest.advanceTimersByTime(GRACE);

    const room = match.view(person(2));
    expect(room.players.find((p) => p.id === seat)?.departedBecause).toBe('disconnected');
    const departure = room.transcript.find((a) => a.kind === 'departure');
    expect(departure?.departedBecause).toBe('disconnected');
    cleanUp(matches);
  });

  it('says they left when they chose to', () => {
    const { lobby, match, matches } = duel();
    const seat = match.view(person(1)).youId;
    lobby.leaveMatch(person(1));

    const room = match.view(person(2));
    expect(room.players.find((p) => p.id === seat)?.departedBecause).toBe('left');
    expect(room.transcript.find((a) => a.kind === 'departure')?.departedBecause).toBe('left');
    cleanUp(matches);
  });

  it.each(['left', 'disconnected'] as const)(
    'takes somebody who %s out of the turn order, so they leave the turn strip',
    (reason) => {
      const { lobby, match, matches } = duel();
      const seat = match.view(person(1)).youId;
      if (reason === 'left') {
        lobby.leaveMatch(person(1));
      } else {
        lobby.disconnected(person(1));
        jest.advanceTimersByTime(GRACE);
      }
      // The strip is drawn from the turn order, lap by lap.
      expect(match.view(person(2)).turnOrder).not.toContain(seat);
      cleanUp(matches);
    }
  );
});
