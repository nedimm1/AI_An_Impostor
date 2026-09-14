/**
 * One match, run on the server.
 *
 * This is `src/game/local-transport.ts` with the phone taken out. The rules are
 * the same file — `roomReducer` — so nothing about how the game plays is
 * decided twice. What moved here is everything that file did around the rules:
 * the clocks that end a turn, a ballot and a result, and the seats that are not
 * held by a person, which now take their turns on this machine instead of on
 * somebody's phone.
 *
 * There is one room and several people looking at it. Each of them is sent a
 * view with their own seat marked as theirs (`view`); the rules never cared
 * which seat was "you", so that is all it takes.
 *
 * SEATS ARE NOT PEOPLE. Inside the room every seat has a seat id, made by the
 * same generator for a person, a stand-in and the impostor alike, and this
 * class keeps the only map from a person's durable player id to their seat.
 * The room never contains a player id. That matters twice: a player id is
 * never meant to be shown to anybody else (`profile.ts`), and ids in two
 * different formats would mark out which seat is not a person without anyone
 * reading a word. What each person is sent is filtered again in `view.ts`.
 *
 * WHAT IS NOT HERE YET, deliberately, because each is its own step:
 * - a player whose connection drops keeps their seat and simply runs out of
 *   time on their turns, the same as putting the phone down. Proper reconnect
 *   handling is step 4.
 * - the stand-ins do not walk out at random the way they do on one device.
 *   With real people in the room, real walkouts are the ones that matter.
 */

import {
  answerDelay,
  answerDelayWithin,
  missesTurn,
  pickReplyTarget,
  voteDelay,
} from '../../src/game/humanlike';
import { impostorBallot, impostorTurn } from '../../src/game/impostor-payload';
import { makeId, makeSessionId, mockAnswer, mockStrangers } from '../../src/game/mock';
import { roomReducer, type MatchAction } from '../../src/game/reducer';
import type { Intent } from '../../src/game/transport';
import {
  currentTurnId,
  DEFAULT_SETTINGS,
  roundAnswers,
  survivors,
  type Player,
  type Room,
} from '../../src/game/types';

import { viewFor } from './view';

/**
 * How long past a deadline the room waits before enforcing it.
 *
 * On one device this was 300ms: the screen submits a half-typed answer on its
 * own clock and only has to beat a timer in the same process. Here the answer
 * also has to cross the network first, so the room gives it longer.
 */
const EXPIRY_GRACE_MS = 1_000;

/** Held back from the impostor's turn so its line still has time to land. See bots.ts. */
const SEND_MARGIN_MS = 1_500;

/** How long a finished match stays up so people can read the reveal. */
const LINGER_AFTER_END_MS = 5 * 60_000;

/**
 * The model, as the match needs it. Injected rather than imported so the match
 * can run in a test without a network, and so the server's accounting (cost,
 * logging) stays in `index.js` where it already is.
 */
export type ImpostorModel = {
  /** A line for the impostor's turn, or null when there is nothing usable. */
  answer: (turn: ReturnType<typeof impostorTurn>) => Promise<string | null>;
  /** The name it votes for, or null. */
  vote: (ballot: ReturnType<typeof impostorBallot>) => Promise<string | null>;
};

/** Resolves with the promise, or with null once `ms` has passed — whichever is first. */
function withinDeadline<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      }
    );
  });
}

export class Match {
  readonly id: string;
  private room: Room;

  /** Person (durable player id) → their seat id in the room. The only place the two meet. */
  private readonly seatOf = new Map<string, string>();
  /** Seat ids held by people. Every other seat is a stand-in or the impostor. */
  private readonly humanSeats: Set<string>;
  /** People (player ids) who were voted out and chose to keep watching. */
  private readonly spectating = new Set<string>();
  /** People (player ids) who walked out. Their seat stays in the room; they stop getting it. */
  private readonly gone = new Set<string>();

  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline: number | null = null;
  private voteTimer: ReturnType<typeof setTimeout> | null = null;
  private voteDeadline: number | null = null;
  private verdictTimer: ReturnType<typeof setTimeout> | null = null;
  private verdictDeadline: number | null = null;

  /** Timers for whichever non-human seat is acting, cancelled when the moment passes. */
  private seatTimers: ReturnType<typeof setTimeout>[] = [];
  private seatTurnKey: string | null = null;
  private seatBallotKey: string | null = null;

  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    humanIds: string[],
    private readonly model: ImpostorModel,
    /** Called after every change, so the caller can send people the new room. */
    private readonly onChange: (match: Match) => void,
    /** Called once, when the match is over and nobody needs it any more. */
    private readonly onEnd: (match: Match) => void
  ) {
    if (humanIds.length === 0) throw new Error('a match needs at least one person');
    const seats = DEFAULT_SETTINGS.playerCount;
    if (humanIds.length > seats - 1) {
      throw new Error(`${humanIds.length} people for ${seats} seats — one seat is the impostor`);
    }

    // A seat for each person, from the same generator `mockStrangers` uses for
    // everyone else — so nothing about a seat's id says whether a person holds it.
    for (const playerId of humanIds) this.seatOf.set(playerId, makeId('p'));
    const seatIds = humanIds.map((id) => this.seatOf.get(id)!);
    this.humanSeats = new Set(seatIds);

    // The other people's seats are drawn exactly like stand-ins: no name and no
    // colour, because the room deals those. The reducer is told which seats are
    // people so the impostor is never one of them.
    const otherPeople: Player[] = seatIds.slice(1).map((id) => ({
      id,
      name: '',
      tint: '',
      isYou: false,
      connected: true,
      eliminated: false,
    }));

    const started = roomReducer(null, {
      type: 'startMatch',
      id: makeSessionId(),
      yourId: seatIds[0],
      strangers: [...otherPeople, ...mockStrangers(seats - humanIds.length)],
      humanIds: seatIds,
    });
    if (!started) throw new Error('the room did not start');

    this.room = started;
    this.id = started.id;
    this.afterChange();
  }

  /** The people (player ids) in this match who have not walked out. */
  players(): string[] {
    return [...this.seatOf.keys()].filter((id) => !this.gone.has(id));
  }

  has(playerId: string) {
    return this.seatOf.has(playerId) && !this.gone.has(playerId);
  }

  /**
   * The room as one person is allowed to see it. Their own seat is marked as
   * theirs, and everything they must not know is taken out — see `view.ts`.
   *
   * `youId`, `isYou` and `spectating` are the only per-person things in a room,
   * and the rules never read them to decide anything — they exist for the
   * screens. So a single room serves everyone, relabelled on the way out.
   */
  view(playerId: string): Room {
    const seatId = this.seatOf.get(playerId);
    if (!seatId) throw new Error('not in this match');
    return viewFor(this.room, seatId, this.spectating.has(playerId));
  }

  /** Something a person did. Anything that is not theirs to do is dropped. */
  handle(playerId: string, intent: Intent) {
    if (this.disposed || !this.has(playerId)) return;
    const seatId = this.seatOf.get(playerId)!;

    switch (intent.type) {
      case 'answer':
        // Only on your own turn — the reducer answers whoever's turn it is, so
        // this check is the whole of "you cannot speak for somebody else".
        if (currentTurnId(this.room) !== seatId) return;
        this.dispatch({
          type: 'answerTurn',
          text: intent.text,
          timedOut: intent.timedOut,
          replyToId: intent.replyToId,
        });
        return;

      case 'vote':
        // The target is a seat id, which is all a phone has ever been shown.
        this.dispatch({ type: 'castVote', voterId: seatId, targetId: intent.targetId });
        return;

      case 'spectate':
        this.spectating.add(playerId);
        this.onChange(this);
        return;

      case 'leave':
        this.leave(playerId);
        return;

      // Test mode lets one phone type for the other seats. On a server that is
      // one person speaking for another, which is the one thing it must refuse.
      case 'answerAs':
        return;
    }
  }

  /** Walk out: final, the seat stays listed, and the room carries on. */
  leave(playerId: string) {
    if (!this.has(playerId)) return;
    this.gone.add(playerId);
    this.dispatch({ type: 'playerLeft', playerId: this.seatOf.get(playerId)! });

    // Nobody left to play for. Stop spending clocks and model calls on it.
    if (this.players().length === 0) this.end();
  }

  // ---------------------------------------------------------------------------

  private dispatch(action: MatchAction) {
    if (this.disposed) return;
    const next = roomReducer(this.room, action);
    // The reducer hands back the same object when an action changed nothing.
    if (!next || next === this.room) return;
    this.room = next;
    this.afterChange();
  }

  private afterChange() {
    this.armClocks();
    this.driveSeats();
    this.onChange(this);

    // A decided match stays up for the reveal, then goes.
    if (this.room.outcome && !this.endTimer) {
      this.endTimer = setTimeout(() => this.end(), LINGER_AFTER_END_MS);
    }
  }

  /**
   * The room's three clocks. Each is re-armed only when its deadline actually
   * moves, so an answer landing mid-turn does not restart the turn.
   */
  private armClocks() {
    const room = this.room;

    const turnEnds = room.phase === 'answering' ? room.turnEndsAt : null;
    if (turnEnds !== this.turnDeadline) {
      if (this.turnTimer) clearTimeout(this.turnTimer);
      this.turnTimer = null;
      this.turnDeadline = turnEnds;
      if (turnEnds !== null) {
        this.turnTimer = setTimeout(
          () => this.dispatch({ type: 'answerTurn', text: '', timedOut: true, replyToId: null }),
          Math.max(0, turnEnds - Date.now() + EXPIRY_GRACE_MS)
        );
      }
    }

    const voteEnds = room.phase === 'voting' && !room.ballotClosed ? room.voteEndsAt : null;
    if (voteEnds !== this.voteDeadline) {
      if (this.voteTimer) clearTimeout(this.voteTimer);
      this.voteTimer = null;
      this.voteDeadline = voteEnds;
      if (voteEnds !== null) {
        this.voteTimer = setTimeout(
          () => this.dispatch({ type: 'closeBallot' }),
          Math.max(0, voteEnds - Date.now() + EXPIRY_GRACE_MS)
        );
      }
    }

    // On one device a voted-out player held the result until they chose to
    // watch or leave. With other people waiting on the next round, one person's
    // choice cannot stop the room — it moves on, and they choose from wherever
    // they are.
    const verdictEnds = room.phase === 'verdict' ? room.verdictEndsAt : null;
    if (verdictEnds !== this.verdictDeadline) {
      if (this.verdictTimer) clearTimeout(this.verdictTimer);
      this.verdictTimer = null;
      this.verdictDeadline = verdictEnds;
      if (verdictEnds !== null) {
        this.verdictTimer = setTimeout(
          () => this.dispatch({ type: 'nextRound' }),
          Math.max(0, verdictEnds - Date.now() + EXPIRY_GRACE_MS)
        );
      }
    }
  }

  /** Starts whatever the non-human seats should be doing right now, once per moment. */
  private driveSeats() {
    const room = this.room;

    const turnKey =
      room.phase === 'answering'
        ? `${room.round}:${room.tiebreaker ? 'tb' : 'r'}:${room.turnIndex}`
        : null;
    const ballotKey =
      room.phase === 'voting' && !room.ballotClosed
        ? `${room.round}:${room.tiebreaker ? 'tb' : 'r'}`
        : null;

    if (turnKey === this.seatTurnKey && ballotKey === this.seatBallotKey) return;

    this.seatTimers.forEach(clearTimeout);
    this.seatTimers = [];
    this.seatTurnKey = turnKey;
    this.seatBallotKey = ballotKey;

    if (turnKey) this.seatTurn(turnKey);
    if (ballotKey) this.seatVotes(ballotKey);
  }

  /** A stand-in's or the impostor's turn. Port of `useBotTurns`. */
  private seatTurn(turnKey: string) {
    const room = this.room;
    const seatId = currentTurnId(room);
    if (!seatId || this.humanSeats.has(seatId)) return;

    const windowMs = room.settings.answerSeconds * 1000;
    const openedAt = Date.now();
    const replyToId = pickReplyTarget(roundAnswers(room), seatId);

    const stillThisTurn = () => !this.disposed && this.seatTurnKey === turnKey;

    const send = (text: string, canMiss: boolean) => {
      if (!stillThisTurn()) return;
      const delay = canMiss ? answerDelay(text, windowMs) : answerDelayWithin(text, windowMs);
      // Running past the clock is a thing people do; the room's own turn
      // expiry then marks them as having run out of time.
      if (canMiss && missesTurn(delay, windowMs)) return;

      this.seatTimers.push(
        setTimeout(() => {
          if (!stillThisTurn() || currentTurnId(this.room) !== seatId) return;
          this.dispatch({ type: 'answerTurn', text, timedOut: false, replyToId });
        }, Math.max(0, delay - (Date.now() - openedAt)))
      );
    };

    if (seatId !== room.impostorId) {
      send(mockAnswer(), true);
      return;
    }

    // The model, straight from here — no phone asking over HTTP any more.
    // Anything that fails or runs long falls back to a stock line, because
    // the room must never be able to tell that the model fell over.
    const deadline = Math.max(1_000, windowMs - SEND_MARGIN_MS);
    withinDeadline(this.model.answer(impostorTurn(room, replyToId)), deadline).then((text) =>
      send(text && text.trim() ? text : mockAnswer(), true)
    );
  }

  /** Every non-human seat's vote. Port of `useStrangerVotes`. */
  private seatVotes(ballotKey: string) {
    const opened = this.room;
    const windowMs = opened.settings.voteSeconds * 1000;

    for (const voter of survivors(opened)) {
      if (this.humanSeats.has(voter.id)) continue;

      const wait = voteDelay(windowMs);
      if (missesTurn(wait, windowMs)) continue;

      let picked: string | null = null;
      if (voter.id === opened.impostorId) {
        const ballot = impostorBallot(opened);
        if (ballot.candidates.length > 0) {
          withinDeadline(this.model.vote(ballot), windowMs).then((name) => {
            if (!name) return;
            // Back to a seat, checked against the room rather than trusted.
            const target = survivors(this.room).find(
              (p) => p.id !== voter.id && p.name.toLowerCase() === name.toLowerCase()
            );
            picked = target?.id ?? null;
          });
        }
      }

      this.seatTimers.push(
        setTimeout(() => {
          const now = this.room;
          if (this.disposed || this.seatBallotKey !== ballotKey) return;
          if (now.phase !== 'voting' || now.ballotClosed) return;

          const options = survivors(now).filter((t) => t.id !== voter.id);
          if (options.length === 0) return;

          const chosen = options.some((o) => o.id === picked)
            ? picked!
            : options[Math.floor(Math.random() * options.length)].id;

          this.dispatch({ type: 'castVote', voterId: voter.id, targetId: chosen });
        }, wait)
      );
    }
  }

  private end() {
    if (this.disposed) return;
    this.disposed = true;
    for (const timer of [this.turnTimer, this.voteTimer, this.verdictTimer, this.endTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.seatTimers.forEach(clearTimeout);
    this.seatTimers = [];
    this.onEnd(this);
  }
}
