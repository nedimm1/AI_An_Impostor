import { Redirect, useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatBubble } from '@/components/game/chat-bubble';
import { Composer } from '@/components/game/composer';
import { RoundBar } from '@/components/game/round-bar';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Colors, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';
import { playerById } from '@/game/types';
import { useCountdown } from '@/hooks/use-countdown';

export default function ChatScreen() {
  const router = useRouter();
  const { room, sendMessage, openVote } = useRoomStore();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList>(null);

  const phase = room?.phase;
  const code = room?.code;

  const goToVote = useCallback(() => {
    if (!code) return;
    openVote();
    router.push({ pathname: '/room/[code]/vote', params: { code } });
  }, [code, openVote, router]);

  // The shared deadline also ticks while the vote screen is on top, so only
  // advance when this screen's own phase is the one that expired.
  const onTimeUp = useCallback(() => {
    if (phase === 'chat') goToVote();
  }, [phase, goToVote]);

  const remaining = useCountdown(room?.phaseEndsAt ?? null, onTimeUp);

  if (!room) return <Redirect href="/" />;

  return (
    <Screen edges={['top', 'left', 'right']} padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <ThemedText type="subtitle">Room {room.code}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {room.players.length} in the chat
            </ThemedText>
          </View>
          <Button label="Vote now" size="sm" variant="secondary" onPress={goToVote} />
        </View>

        <RoundBar
          round={room.round}
          totalRounds={room.settings.rounds}
          prompt={room.prompt}
          remaining={remaining}
          duration={room.settings.chatSeconds}
        />

        <FlatList
          ref={listRef}
          data={room.messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item, index }) => {
            const previous = room.messages[index - 1];
            const showAuthor =
              !previous || previous.kind === 'system' || previous.playerId !== item.playerId;
            return (
              <ChatBubble
                message={item}
                author={playerById(room, item.playerId)}
                showAuthor={showAuthor}
              />
            );
          }}
        />

        <Composer onSend={sendMessage} />
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
  listContent: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    flexGrow: 1,
  },
});
