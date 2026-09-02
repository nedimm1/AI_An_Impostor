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
import { useBotTurns } from '@/game/bots';
import { useRoomStore } from '@/game/store';
import {
  answerById,
  currentTurnId,
  currentTurnNumber,
  isYourTurn,
  playerById,
  survivors,
  voteResult,
  voteTally,
  YOU_ID,
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
  const { room, answerTurn, castVote, resolveVote } = useRoomStore();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // The answer you are writing back at, picked by long-pressing its bubble.
  const [replyToId, setReplyToId] = useState<string | null>(null);
  // Who you are about to vote for, before you lock it in.
  const [voteFor, setVoteFor] = useState<string | null>(null);

  useBotTurns(room, answerTurn);

  const phase = room?.phase;
  const id = room?.id;
  const round = room?.round;

  // Answers are cleared between rounds, so a target from the last one is gone.
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

  // A turn that expires still counts as an answer. Whatever you had typed goes
  // to the room as it stands, half a sentence and all — only a box you never
  // wrote in passes the turn empty.
  const onTimeUp = useCallback(() => {
    if (phase !== 'answering') return;
    const draft = yourTurn && !out ? (composerRef.current?.takeDraft() ?? '') : '';
    answerTurn(draft, draft.trim().length === 0, replyToId);
    setReplyToId(null);
  }, [phase, yourTurn, out, answerTurn, replyToId]);

  const remaining = useCountdown(room?.turnEndsAt ?? null, onTimeUp);

  if (!room) return <Redirect href="/" />;

  const speaker = playerById(room, currentTurnId(room));
  const alive = survivors(room);
  const stillIn = alive.length;

  const voting = room.phase === 'voting';
  const inTiebreaker = room.tiebreaker !== null;
  const accused = youAreAccused(room);
  const speakerAccused = speaker ? (room.tiebreaker?.includes(speaker.id) ?? false) : false;

  const votesIn = Object.keys(room.votes).length > 0;
  // A first tie opens a tiebreaker, not a result — say so on the button.
  const opensTiebreaker = !inTiebreaker && votesIn && voteResult(room).kind === 'tied';
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
          data={room.answers}
          extraData={replyToId}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <ThemedText type="small" themeColor="textMuted" style={styles.empty}>
              Nobody has answered yet.
            </ThemedText>
          }
          renderItem={({ item }) => {
            const quoted = answerById(room, item.replyToId);
            return (
              <AnswerBubble
                answer={item}
                author={playerById(room, item.playerId)}
                replyTo={quoted}
                replyToAuthor={playerById(room, quoted?.playerId)}
                onReply={out ? undefined : () => setReplyToId(item.id)}
                replySelected={item.id === replyToId}
              />
            );
          }}
        />

        {voting ? (
          <VotePanel
            targets={alive}
            accused={room.tiebreaker ?? []}
            selected={votesIn ? (room.votes[YOU_ID] ?? null) : voteFor}
            onSelect={setVoteFor}
            votesIn={votesIn}
            tally={votesIn ? voteTally(room) : {}}
            canVote={!out}
            title={inTiebreaker ? `It is between ${accusedNames}` : 'Who is the impostor?'}
            note={
              votesIn
                ? 'You cannot change your vote.'
                : out
                  ? 'Eliminated players do not get a vote.'
                  : inTiebreaker
                    ? 'Not convinced by either? Name somebody else.'
                    : 'Nobody sees the tally until you lock in.'
            }
            actionLabel={
              votesIn
                ? opensTiebreaker
                  ? 'It is a tie — talk it out'
                  : 'See the result'
                : out
                  ? 'Watch the vote'
                  : 'Lock in vote'
            }
            onAction={() => {
              if (votesIn) resolveVote();
              else castVote(out ? null : voteFor);
            }}
          />
        ) : (
        <Composer
          ref={composerRef}
          onSend={(text) => {
            answerTurn(text, false, replyToId);
            setReplyToId(null);
          }}
          disabled={!yourTurn || out}
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
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.five,
  },
});
