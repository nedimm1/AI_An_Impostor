import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AnswerBubble } from '@/components/game/answer-bubble';
import { Composer, type ComposerHandle } from '@/components/game/composer';
import { RoundBar } from '@/components/game/round-bar';
import { VotePanel } from '@/components/game/vote-panel';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';
import { colorForId, Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';
import { TEST_MODE } from '@/game/testing';
import {
  answerById,
  currentTurnId,
  currentTurnNumber,
  isYourTurn,
  playerById,
  roundAnswers,
  survivors,
  youAreAccused,
  youAreOut,
} from '@/game/types';
import { useCountdown } from '@/hooks/use-countdown';
import { useLeaveGame } from '@/hooks/use-leave-game';

/**
 * One round of answers. Everyone still in gets the same prompt and forty-five seconds
 * each, in turn. When the last answer lands the room goes to the vote.
 */
export default function RoundScreen() {
  const router = useRouter();
  const { room, send } = useRoomStore();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const composerRef = useRef<ComposerHandle>(null);
  // A new answer always pulls the transcript to the end, however far back you
  // had scrolled. The flag holds the scroll open until the new bubble has been
  // measured, since the list has no height for it yet when the answer lands.
  const pendingScroll = useRef(false);

  // The answer you are writing back at, picked by long-pressing its bubble.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  // Who you are about to vote for, before you lock it in.
  const [voteFor, setVoteFor] = useState<string | null>(null);

  const phase = room?.phase;
  const id = room?.id;
  const round = room?.round;

  // Every answer that lands — yours or theirs — takes the transcript to the end.
  const answerCount = room ? roundAnswers(room).length : 0;
  useEffect(() => {
    if (answerCount === 0) return;
    pendingScroll.current = true;
    listRef.current?.scrollToEnd({ animated: true });
  }, [answerCount]);

  // The room only shows the round it is on, so a target from the last one has
  // gone off screen even though the transcript still holds it.
  useEffect(() => setReplyToId(null), [round]);
  useEffect(() => setVoteFor(null), [round, phase]);

  // Walking out is final — the matchmaker doesn't hold your seat and these
  // strangers are not a room you can find again.
  const handleLeave = useLeaveGame();

  // The vote happens here, under the chatroom. Only the verdict is its own
  // screen, since by then there is nothing left to read back through.
  useEffect(() => {
    if (phase === 'verdict' && id) {
      router.replace({ pathname: '/room/[id]/results', params: { id } });
    }
  }, [phase, id, router]);

  const yourTurn = room ? isYourTurn(room) : false;
  const out = room ? youAreOut(room) : false;

  // Under test the stand-ins say nothing on their own, so their turn is yours
  // to type. The impostor's is not: that one is the model's, and watching it
  // answer into a room you wrote is the entire point of the mode.
  const speakerId = room ? currentTurnId(room) : null;
  const typingForStranger =
    TEST_MODE &&
    room !== null &&
    room.phase === 'answering' &&
    speakerId !== null &&
    speakerId !== room.youId &&
    speakerId !== room.impostorId;

  // A turn that expires still counts as an answer. Whatever you had typed goes
  // to the room as it stands, half a sentence and all — only a box you never
  // wrote in passes the turn empty.
  //
  // Only your own turn is sent from here: the room enforces everybody's clock,
  // including yours, a moment later. This is the app getting your draft in
  // before it does.
  const onTimeUp = useCallback(() => {
    if (phase !== 'answering' || !yourTurn || out) return;
    const draft = composerRef.current?.takeDraft() ?? '';
    send({ type: 'answer', text: draft, timedOut: draft.trim().length === 0, replyToId });
    setReplyToId(null);
  }, [phase, yourTurn, out, send, replyToId]);

  // No clock under test — the room is waiting on how fast you can type six
  // people, and `local-transport` has stopped enforcing the deadline anyway.
  const remaining = useCountdown(TEST_MODE ? null : (room?.turnEndsAt ?? null), onTimeUp);

  // Whatever you had picked goes in as it stands. Closing the ballot is the
  // room's to do, not this screen's — it does that on its own clock, a moment
  // after this one, so a last-second pick still counts.
  const onVoteTimeUp = useCallback(() => {
    if (!room || room.phase !== 'voting' || room.ballotClosed) return;
    if (!out && !room.voted.includes(room.youId)) send({ type: 'vote', targetId: voteFor });
  }, [room, out, voteFor, send]);

  const voteRemaining = useCountdown(room?.voteEndsAt ?? null, onVoteTimeUp);

  if (!room) return <Redirect href="/" />;

  // What the room can see: this round only. The rest of the match is kept on
  // the room, it is just not what anybody is reading back.
  const visible = roundAnswers(room);
  const speaker = playerById(room, currentTurnId(room));
  const alive = survivors(room);
  const stillIn = alive.length;

  const voting = room.phase === 'voting';
  const inTiebreaker = room.tiebreaker !== null;
  // An accused player who walked out leaves the tiebreaker with one side. The
  // room still votes, but there is no longer a pair to put it "between".
  const accusationHeld = (room.tiebreaker?.length ?? 0) >= 2;
  const accused = youAreAccused(room);
  const speakerAccused = speaker ? (room.tiebreaker?.includes(speaker.id) ?? false) : false;

  // You are locked once your vote is in — or from the start, if you are out and
  // only watching the room decide.
  const youVoted = room.voted.includes(room.youId);
  const locked = youVoted || out;
  // Worth saying out loud only once it is about to cost you a vote.
  const ballotClosing =
    !locked && voteFor === null && voteRemaining !== null && voteRemaining <= 10;
  const accusedNames = (room.tiebreaker ?? [])
    .map((tid) => playerById(room, tid)?.name ?? 'someone')
    .join(' and ');

  const replyTarget = answerById(room, replyToId);
  const replyAuthor = playerById(room, replyTarget?.playerId);

  const status = voting
    ? out
      ? 'You are out — the room votes without you'
      : 'Everyone has spoken. Read it back, then vote.'
    : out
      ? 'You are out — watching'
    : typingForStranger && speaker
      ? `Answering as ${speaker.name}`
      : yourTurn
      ? inTiebreaker
        ? accused
          ? 'Your turn — say why it is not you'
          : 'Your turn — say what you make of it'
        : 'Your turn'
      : speaker
        ? inTiebreaker && speakerAccused
          ? `${speaker.name} is making their case…`
          : `${speaker.name} is answering…`
        : 'Everyone has spoken';

  const placeholder = out
    ? 'You are out of the game'
    : typingForStranger && speaker
      ? `Type ${speaker.name}'s answer…`
      : yourTurn
      ? inTiebreaker
        ? accused
          ? 'Why is it not you?'
          : 'What do you make of it?'
        : 'Type your answer…'
      : speaker
        ? `Waiting for ${speaker.name}…`
        : 'Waiting…';

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Leave the game"
            onPress={handleLeave}
            hitSlop={12}
            style={({ pressed }) => [styles.leaveButton, pressed && styles.pressed]}>
            <ThemedText type="body" style={styles.leaveGlyph}>
              ✕
            </ThemedText>
          </Pressable>

          <View style={styles.headerText}>
            <ThemedText type="subtitle">The chatroom</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {stillIn} still in · one isn&apos;t a person
            </ThemedText>
          </View>
        </View>

        <RoundBar
          round={room.round}
          turn={
            inTiebreaker
              ? Math.min(room.turnIndex + 1, room.turnOrder.length)
              : currentTurnNumber(room)
          }
          turnsEach={inTiebreaker ? room.turnOrder.length : room.settings.turnsEach}
          tiebreaker={inTiebreaker}
          prompt={room.prompt}
          remaining={remaining}
          duration={room.settings.answerSeconds}
          status={status}
        />

        <FlatList
          ref={listRef}
          data={visible}
          extraData={replyToId}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          onContentSizeChange={() => {
            if (!pendingScroll.current) return;
            pendingScroll.current = false;
            listRef.current?.scrollToEnd({ animated: true });
          }}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textMuted" style={styles.empty}>
              Nobody has answered yet.
            </ThemedText>
          }
          renderItem={({ item, index }) => {
            const quoted = answerById(room, item.replyToId);
            // Everything above this line was said before the room tied.
            const opensTheTiebreaker =
              item.inTiebreaker && !visible[index - 1]?.inTiebreaker;

            const marker = opensTheTiebreaker ? (
              <View style={styles.marker}>
                <View style={styles.markerRule} />
                <ThemedText type="label" themeColor="warning">
                  Tiebreaker
                </ThemedText>
                <View style={styles.markerRule} />
              </View>
            ) : null;

            // Somebody walking out is part of the round, so it reads in the
            // transcript where it happened rather than only in the roster.
            if (item.kind === 'departure') {
              const who = playerById(room, item.playerId);
              return (
                <>
                  {marker}
                  <ThemedText type="small" themeColor="textMuted" style={styles.departure}>
                    {who?.name ?? 'Someone'} left the room
                  </ThemedText>
                </>
              );
            }

            return (
              <>
                {marker}

                <AnswerBubble
                  answer={item}
                  author={playerById(room, item.playerId)}
                  replyTo={quoted}
                  replyToAuthor={playerById(room, quoted?.playerId)}
                  onReply={out ? undefined : () => setReplyToId(item.id)}
                  replySelected={item.id === replyToId}
                />
              </>
            );
          }}
        />

        {voting ? (
          <VotePanel
            targets={alive}
            accused={accusationHeld ? (room.tiebreaker ?? []) : []}
            selected={youVoted ? (room.votes[room.youId] ?? null) : voteFor}
            onSelect={setVoteFor}
            locked={locked}
            votedCount={room.voted.length}
            voterCount={alive.length}
            canVote={!out}
            title={
              inTiebreaker && accusationHeld
                ? `It is between ${accusedNames}`
                : 'Who is the impostor?'
            }
            remaining={voteRemaining}
            note={
              youVoted
                ? 'Waiting on the room. Nobody sees a tally until it is in.'
                : out
                  ? 'Eliminated players do not get a vote.'
                  : ballotClosing
                    ? 'The ballot is closing. No pick counts as no vote.'
                    : inTiebreaker && accusationHeld
                      ? 'Not convinced by either? Name somebody else.'
                      : 'Nobody sees the tally until the room is in.'
            }
            actionLabel="Lock in vote"
            onAction={() => send({ type: 'vote', targetId: voteFor })}
          />
        ) : (
        <Composer
          ref={composerRef}
          onSend={(text) => {
            // Same box, two senders. Which one it is depends only on whose
            // turn the room is on, so there is nothing to keep in sync.
            if (typingForStranger && speakerId) {
              send({ type: 'answerAs', playerId: speakerId, text, replyToId });
            } else {
              send({ type: 'answer', text, timedOut: false, replyToId });
            }
            setReplyToId(null);
          }}
          disabled={(!yourTurn && !typingForStranger) || out}
          placeholder={placeholder}
          replyTo={
            replyTarget && replyAuthor
              ? {
                  name: replyAuthor.isYou ? 'yourself' : replyAuthor.name,
                  text: replyTarget.text,
                  color: colorForId(replyAuthor.id),
                }
              : null
          }
          onCancelReply={() => setReplyToId(null)}
        />
        )}
        <View style={{ height: insets.bottom, backgroundColor: Colors.background }} />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  leaveButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveGlyph: {
    color: Colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    flexGrow: 1,
  },
  marker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.one,
  },
  markerRule: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  departure: {
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.five,
  },
});
