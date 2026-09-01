import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
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
import { Composer } from '@/components/game/composer';
import { RoundBar } from '@/components/game/round-bar';
import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useBotTurns } from '@/game/bots';
import { useRoomStore } from '@/game/store';
import {
  currentTurnId,
  currentTurnNumber,
  isYourTurn,
  playerById,
  survivors,
  youAreOut,
} from '@/game/types';
import { useCountdown } from '@/hooks/use-countdown';
import { useLeaveGame } from '@/hooks/use-leave-game';

/**
 * One round of answers. Everyone still in gets the same prompt and a minute
 * each, in turn. When the last answer lands the room goes to the vote.
 */
export default function RoundScreen() {
  const router = useRouter();
  const { room, answerTurn } = useRoomStore();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);

  useBotTurns(room, answerTurn);

  const phase = room?.phase;
  const id = room?.id;

  // Walking out is final — the matchmaker doesn't hold your seat and these
  // strangers are not a room you can find again.
  const handleLeave = useLeaveGame();

  // The last answer flips the phase; the vote is a screen of its own.
  useEffect(() => {
    if (phase === 'voting' && id) {
      router.replace({ pathname: '/room/[id]/vote', params: { id } });
    }
  }, [phase, id, router]);

  // A turn that expires counts as an answer — an empty one.
  const onTimeUp = useCallback(() => {
    if (phase === 'answering') answerTurn('', true);
  }, [phase, answerTurn]);

  const remaining = useCountdown(room?.turnEndsAt ?? null, onTimeUp);

  if (!room) return <Redirect href="/" />;

  const yourTurn = isYourTurn(room);
  const out = youAreOut(room);
  const speaker = playerById(room, currentTurnId(room));
  const stillIn = survivors(room).length;

  const status = out
    ? 'You are out — watching'
    : yourTurn
      ? 'Your turn'
      : speaker
        ? `${speaker.name} is answering…`
        : 'Everyone has answered';

  const placeholder = out
    ? 'You are out of the game'
    : yourTurn
      ? 'Type your answer…'
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
          turn={currentTurnNumber(room)}
          turnsEach={room.settings.turnsEach}
          prompt={room.prompt}
          remaining={remaining}
          duration={room.settings.answerSeconds}
          status={status}
        />

        <FlatList
          ref={listRef}
          data={room.answers}
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
          renderItem={({ item }) => (
            <AnswerBubble answer={item} author={playerById(room, item.playerId)} />
          )}
        />

        <Composer
          onSend={(text) => answerTurn(text, false)}
          disabled={!yourTurn || out}
          placeholder={placeholder}
        />
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
