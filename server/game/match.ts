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
 * EVERY SEAT BUT ONE IS A PERSON. A room is as many people as the lobby found,
 * plus the impostor — no stand-ins filling the gaps, because stock lines are
 * spotted in a round and a room of obvious fakes is not a room hunting one
 * hidden one. See `lobby.ts` for how big a room gets.
 *
 * WHAT IS NOT HERE YET, deliberately, because it is its own step: a player
 * whose connection drops keeps their seat and simply runs out of time on their
 * turns, the same as putting the phone down. Proper reconnect handling is
 * step 4.
 */

import {
  answerDelay,
  answerDelayWithin,
  missesTurn,
  pickReplyTarget,
  voteDelay,
} from '../../src/game/humanlike';
import { impostorBallot, impostorTurn } from '../../src/game/impostor-payload';
import { makeId, makeSessionId, mockAnswer } from '../../src/game/mock';
import { roomReducer, type MatchAction } from '../../src/game/reducer';
import { momentOf } from '../../src/game/protocol';
import type { Intent } from '../../src/game/transport';
import {
  currentTurnId,
  DEFAULT_SETTINGS,
  roundAnswers,
  survivors,
  type DepartureReason,
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

/** The longest draft kept — well past anything the composer lets you type. */
const MAX_DRAFT_CHARS = 1_000;

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

  /** Seat id → when that person, whose connection is down, will be removed (server clock). */
  private readonly awayUntil = new Map<string, number>();
  /**
   * Seat id → what that person had typed on their turn, and the moment it was
   * typed in. Kept only so it can be put in the room if their connection drops
   * before they send it; never included in anything sent to a phone.
   */
  private readonly drafts = new Map<string, { at: string; text: string }>();

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
    const fullRoom = DEFAULT_SETTINGS.playerCount - 1;
    if (humanIds.length > fullRoom) {
      throw new Error(`${humanIds.length} people for a room of ${fullRoom} — one seat is the impostor`);
    }

    // A seat for each person, from the same generator `mockStrangers` uses for
    // everyone else — so nothing about a seat's id says whether a person holds it.
    for (const playerId of humanIds) this.seatOf.set(playerId, makeId('p'));
    const seatIds = humanIds.map((id) => this.seatOf.get(id)!);
    this.humanSeats = new Set(seatIds);

    // The other people's seats, plus exactly one more for the impostor. No name
    // and no colour on any of them, because the room deals those. The reducer
    // is told which seats are people, so the one that is not is the impostor.
    const unnamed = (id: string): Player => ({
      id,
      name: '',
      tint: '',
      isYou: false,
      connected: true,
      eliminated: false,
    });

    const started = roomReducer(null, {
      type: 'startMatch',
      id: makeSessionId(),
      yourId: seatIds[0],
      strangers: [...seatIds.slice(1).map(unnamed), unnamed(makeId('p'))],
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

  /** Decided — the reveal is up and nothing is left to play. */
  isOver() {
    return this.room.outcome !== null;
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
    return viewFor(this.room, seatId, this.spectating.has(playerId), this.awayUntil);
  }

  /**
   * Something a person did. Anything that is not theirs to do is dropped.
   *
   * `at` is the moment the phone was looking at when it was sent (`momentOf`).
   * An answer or a vote for a moment that has passed is dropped too: a phone
   * that lost its connection sends what it was holding once it is back, and an
   * answer typed for the last lap must not land on your turn in this one.
   */
  handle(playerId: string, intent: Intent, at?: string) {
    if (this.disposed || !this.has(playerId)) return;
    const seatId = this.seatOf.get(playerId)!;

    const timely = at === undefined || at === momentOf(this.room);
    if ((intent.type === 'answer' || intent.type === 'vote') && !timely) return;

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

  /**
   * What somebody has typed so far on their turn. Kept for the moment it was
   * typed in, and only if it is their turn in that moment — anything else is
   * not an answer in progress.
   */
  draft(playerId: string, text: string, at: string) {
    if (this.disposed || !this.has(playerId)) return;
    const seatId = this.seatOf.get(playerId)!;
    if (this.room.phase !== 'answering' || currentTurnId(this.room) !== seatId) return;
    if (at !== momentOf(this.room)) return;
    this.drafts.set(seatId, { at, text: text.slice(0, MAX_DRAFT_CHARS) });
  }

  /**
   * Their connection went (`until` is when they will be removed), or came back
   * (`null`). Everybody in the room is told, so the seat can show a countdown.
   */
  setAway(playerId: string, until: number | null) {
    if (this.disposed || !this.has(playerId)) return;
    const seatId = this.seatOf.get(playerId)!;
    if (until === null) {
      if (!this.awayUntil.delete(seatId)) return;
    } else {
      this.awayUntil.set(seatId, until);
    }
    this.onChange(this);
  }

  /**
   * Gone too long. If it is their turn, what they had typed goes in the room
   * first — or, if nothing, a line saying their connection went — and then
   * they are out, the same as walking out.
   */
  removeForBeingAway(playerId: string) {
    if (!this.has(playerId)) return;
    const seatId = this.seatOf.get(playerId)!;
    if (this.room.phase === 'answering' && currentTurnId(this.room) === seatId) {
      this.dispatch(this.lostConnectionAnswer(seatId));
    }
    this.awayUntil.delete(seatId);
    this.leave(playerId, 'disconnected');
  }

  /** Walk out: final, the seat stays listed, and the room carries on. */
  leave(playerId: string, reason: DepartureReason = 'left') {
    if (!this.has(playerId)) return;
    this.gone.add(playerId);
    this.dispatch({ type: 'playerLeft', playerId: this.seatOf.get(playerId)!, reason });

    // Nobody left to play for. Stop spending clocks and model calls on it.
    if (this.players().length === 0) this.end();
  }

  // ---------------------------------------------------------------------------

  /**
   * What goes in the room when a turn's clock runs out.
   *
   * Somebody still connected who sent nothing ran out of time — their phone
   * sends whatever was in the box on its own clock, so reaching this with them
   * connected means there was nothing. Somebody disconnected could not send,
   * so what they had typed is sent for them.
   */
  private expiredTurnAnswer(): MatchAction {
    const seatId = currentTurnId(this.room);
    if (seatId && this.awayUntil.has(seatId)) return this.lostConnectionAnswer(seatId);
    return { type: 'answerTurn', text: '', timedOut: true, replyToId: null };
  }

  /** Their draft for this turn if they had one, otherwise an empty "lost connection" line. */
  private lostConnectionAnswer(seatId: string): MatchAction {
    const draft = this.drafts.get(seatId);
    const text = draft && draft.at === momentOf(this.room) ? draft.text.trim() : '';
    return {
      type: 'answerTurn',
      text,
      timedOut: text.length === 0,
      replyToId: null,
      lostConnection: true,
    };
  }

  private dispatch(action: MatchAction) {
    if (this.disposed) return;
    const next = roomReducer(this.room, action);
    // The reducer hands back the same object when an action changed nothing.
    if (!next || next === this.room) return;
    this.room = next;
    this.afterChange();
  }

  private afterChange() {
    // A draft belongs to one turn. Once the match has moved on it is not an
    // answer in progress any more.
    const now = momentOf(this.room);
    for (const [seatId, d] of this.drafts) if (d.at !== now) this.drafts.delete(seatId);

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
          () => this.dispatch(this.expiredTurnAnswer()),
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

  /** The impostor's turn. Port of `useBotTurns`, for the one seat that is not a person. */
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

    if (seatId !== room.impostorId) return;

    // The model, straight from here — no phone asking over HTTP any more.
    // Anything that fails or runs long falls back to a stock line, because
    // the room must never be able to tell that the model fell over.
    const deadline = Math.max(1_000, windowMs - SEND_MARGIN_MS);
    withinDeadline(this.model.answer(impostorTurn(room, replyToId)), deadline).then((text) =>
      send(text && text.trim() ? text : mockAnswer(), true)
    );
  }

  /** The impostor's vote. Port of `useStrangerVotes`, for the one seat that is not a person. */
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
