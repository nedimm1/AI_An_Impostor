/**
 * What the impostor is shown, built from a room.
 *
 * Kept apart from `impostor.ts` because these two functions are pure and the
 * rest of that file is not: it fetches, reads `EXPO_PUBLIC_` config and logs
 * through a React hook. The server needs exactly these two and none of that —
 * once the match runs there, it builds the same payload and hands it straight
 * to the model, with no phone and no HTTP hop in between. One definition means
 * the phone path and the server path cannot drift into showing the model two
 * different rooms.
 */

import {
  answerById,
  currentTurnNumber,
  playerById,
  roundAnswers,
  survivors,
  type Room,
} from './types';

/**
 * One ballot, by name.
 *
 * Every player saw this: the result screen puts each voter's face under the
 * name they picked, and it stays true for the rest of the match. So it is not
 * a secret being handed over — it is the impostor being given the same sheet
 * of paper everybody else is still holding, without which it cannot answer
 * the plainest question in the game. It voted for somebody two rounds ago and
 * the room can see who.
 *
 * `yours` is drawn out on its own because that is the one line it will be
 * asked to account for, and a model made to find itself in a list will
 * sometimes find the wrong seat.
 *
 * The round each vote was cast on is deliberately not here. It was, while the
 * impostor answered "why did you vote for me" with a reason: a reason has to
 * come out of something, and without the round it invented one. It does not
 * give reasons any more — it shrugs, every time, however hard it is pushed —
 * so the round would be evidence for a case it is never going to make.
 */
export type ImpostorBallotRecord = {
  /** The round it was cast in. A tiebreaker's second ballot shares the round. */
  round: number;
  yours: string | null;
  /** Everyone who named somebody, in no particular order. Abstentions are absent. */
  votes: { voter: string; target: string }[];
  /** Who it removed, or null when it tied or settled on nobody. */
  eliminated: string | null;
};

/** Every ballot so far, oldest first, as names. Empty before the first one. */
function ballotsFor(room: Room): ImpostorBallotRecord[] {
  const nameOf = (id: string) => playerById(room, id)?.name ?? null;

  return room.ballots.map((ballot) => {
    const votes: { voter: string; target: string }[] = [];
    for (const [voterId, targetId] of Object.entries(ballot.votes)) {
      const voter = nameOf(voterId);
      const target = nameOf(targetId);
      if (voter && target) votes.push({ voter, target });
    }

    return {
      round: ballot.round,
      yours: room.impostorId ? nameOf(ballot.votes[room.impostorId] ?? '') : null,
      votes,
      eliminated: ballot.eliminatedId ? nameOf(ballot.eliminatedId) : null,
    };
  });
}

/** What the impostor is allowed to know about the room. */
export type ImpostorTurn = {
  roomId: string;
  /**
   * The name on its seat. Sent rather than chosen server-side because the
   * matchmaker picks it: an impostor told it is Mr. Green while the room sees Mr. Pink
   * answers to the wrong name in front of everybody, and it is reading a
   * transcript its own lines appear in, so it has to recognise itself.
   */
  name: string;
  prompt: string;
  answerSeconds: number;
  /** This round's lines, in order — the same thing on everybody's screen. */
  roundLines: { name: string; text: string; replyToName: string | null }[];
  /** What it said in earlier rounds, which only it can still see. */
  ownHistory: string[];
  /**
   * Which time round the room this is, 1-based, and how many there are.
   *
   * Sent because turn one and turn three are not the same turn and were being
   * prompted as though they were. On turn one the question is unanswered and
   * answering it is the job; by turn three everybody has answered, the room is
   * talking, and a model still being told to answer the question has nothing
   * left to say and says two words of nothing.
   */
  turnNumber: number;
  turnsEach: number;
  /**
   * Whether anybody has written back at it, and who at whom generally.
   *
   * The transcript used to be flattened to name and text, which threw away
   * the one piece of structure the room can see and the impostor could not:
   * that a line was aimed at somebody. Being replied to and not noticing is
   * the most human-looking mistake there is to make and the least human thing
   * to do, since on a phone the reply is drawn under your own message with
   * your words quoted inside it. It is not subtle and nobody misses it.
   */
  /**
   * Everybody still in the room, itself included.
   *
   * Sent because the transcript is not a roster: a player who walked out or
   * was voted out an hour ago is still all over it, and the impostor turned
   * on one of them twice in a round they had already left. Somebody who has
   * gone cannot answer, cannot be voted for, and cannot take any heat off it.
   */
  stillIn: string[];
  /**
   * Every vote the room has been shown, oldest first. It can still see all of
   * them and can still ask about any of them — most likely of all during a
   * tiebreaker, where the vote that tied is the reason everybody is talking.
   */
  ballots: ImpostorBallotRecord[];
  /** The room is talking out a tied vote rather than answering a prompt. */
  tiebreaker: boolean;
  /** It is one of the two the room is deciding between. */
  accused: boolean;
  /**
   * The message this turn is aimed at, or null to answer the room cold.
   *
   * Drawn before the words exist, not after. The room pins a reply under the
   * message it answers whichever way round it happens, so a line written
   * without knowing its target and then attached to one reads exactly as
   * blind as it was — which is the single loudest thing the impostor can do
   * and what it was doing until this was passed through.
   */
  replyTo: { name: string; text: string } | null;
};

/**
 * The room, reduced to a turn.
 *
 * Kept pure and exported so it can be tested without a server: what the
 * impostor is told is a rule of the game, and rules belong under test. The two
 * halves are separate on purpose — the room can only see the round it is on,
 * so previous rounds appear as the impostor's own memory rather than as
 * transcript, and its lines from *this* round arrive in `roundLines` like
 * anybody else's.
 */
export function impostorTurn(room: Room, replyToId: string | null = null): ImpostorTurn {
  const spoken = roundAnswers(room).filter((a) => a.kind === 'answer' && !a.timedOut);
  const target = answerById(room, replyToId);
  const targetAuthor = playerById(room, target?.playerId);

  return {
    roomId: room.id,
    name: playerById(room, room.impostorId)?.name ?? 'you',
    // Already the tiebreaker's own wording when there is one — the reducer
    // swaps it in, so there is only ever one prompt to read.
    prompt: room.prompt,
    answerSeconds: room.settings.answerSeconds,
    turnNumber: currentTurnNumber(room),
    turnsEach: room.settings.turnsEach,
    stillIn: survivors(room).map((p) => p.name),
    ballots: ballotsFor(room),
    tiebreaker: room.tiebreaker !== null,
    accused: room.tiebreaker?.includes(room.impostorId ?? '') ?? false,
    replyTo:
      target && targetAuthor ? { name: targetAuthor.name, text: target.text } : null,
    roundLines: spoken.map((answer) => {
      // Who the line was written at, when it was written at anybody. The room
      // renders this as a quote above the message; the impostor gets the same
      // fact as a name, which is all it needs to notice one aimed at itself.
      const at = playerById(room, answerById(room, answer.replyToId)?.playerId);
      return {
        name: playerById(room, answer.playerId)?.name ?? 'someone',
        text: answer.text,
        replyToName: at?.name ?? null,
      };
    }),
    ownHistory: room.transcript
      .filter(
        (a) =>
          a.kind === 'answer' &&
          a.playerId === room.impostorId &&
          a.round < room.round &&
          !a.timedOut
      )
      .map((a) => a.text),
  };
}

/** What the impostor is allowed to know when the ballot is open. */
export type ImpostorBallot = {
  roomId: string;
  name: string;
  round: number;
  prompt: string;
  roundLines: { name: string; text: string }[];
  /** Everyone it can name. Never itself — that is not a vote, it is a bug. */
  candidates: string[];
  /**
   * How it has voted so far, and how everybody else has.
   *
   * Carried because this vote will be read against those ones: switching from
   * one name to another is a thing the room can see, and so is voting for
   * somebody twice.
   */
  ballots: ImpostorBallotRecord[];
  /** The two a tied vote put up, if the room is on its second ballot. */
  accused: string[];
};

/**
 * The room, reduced to a ballot.
 *
 * The impostor is the one player in the room with nothing to work out: it
 * knows every other seat is a person. So this carries no more than the room
 * does — what was said, and who is still in — because the question it is
 * answering is not "who is the AI" but "who do I want gone", and the second
 * one needs less.
 */
export function impostorBallot(room: Room): ImpostorBallot {
  const alive = survivors(room);
  return {
    roomId: room.id,
    name: playerById(room, room.impostorId)?.name ?? 'you',
    round: room.round,
    prompt: room.prompt,
    roundLines: roundAnswers(room)
      .filter((a) => a.kind === 'answer' && !a.timedOut)
      .map((answer) => ({
        name: room.players.find((p) => p.id === answer.playerId)?.name ?? 'someone',
        text: answer.text,
      })),
    candidates: alive.filter((p) => p.id !== room.impostorId).map((p) => p.name),
    ballots: ballotsFor(room),
    accused: (room.tiebreaker ?? [])
      .map((id) => playerById(room, id)?.name)
      .filter((name): name is string => name !== undefined),
  };
}
