import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { VoteRow } from '@/components/game/vote-row';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';
import { survivors, voteTally, YOU_ID, youAreOut } from '@/game/types';
import { useLeaveGame } from '@/hooks/use-leave-game';

/**
 * The vote that closes a round. Untimed on purpose — the only clock in this
 * game is the minute each player gets to answer.
 */
export default function VoteScreen() {
  const router = useRouter();
  const { room, castVote, resolveVote } = useRoomStore();
  const [selected, setSelected] = useState<string | null>(null);
  const handleLeave = useLeaveGame();

  const id = room?.id;

  const goToVerdict = useCallback(() => {
    if (!id) return;
    resolveVote();
    router.replace({ pathname: '/room/[id]/results', params: { id } });
  }, [id, resolveVote, router]);

  if (!room) return <Redirect href="/" />;

  const out = youAreOut(room);
  const alive = survivors(room);
  const votesIn = Object.keys(room.votes).length > 0;
  const tally = voteTally(room);

  return (
    <Screen>
      <ScreenHeader
        onBack={handleLeave}
        title="Who is the impostor?"
        subtitle={
          out
            ? 'You are out — the room votes without you'
            : votesIn
              ? 'Votes are in'
              : `Pick one of the ${alive.length} still in`
        }
      />

      <ThemedText type="small" themeColor="textMuted" style={styles.prompt}>
        Round {room.round}: {room.prompt}
      </ThemedText>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {alive.map((player) => (
          <VoteRow
            key={player.id}
            player={player}
            selected={votesIn ? room.votes[YOU_ID] === player.id : selected === player.id}
            voteCount={votesIn ? (tally[player.id] ?? 0) : undefined}
            disabled={player.isYou || votesIn || out}
            dimmed={player.isYou}
            onPress={() => setSelected(player.id)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {votesIn ? (
          <Button label="See the result" onPress={goToVerdict} />
        ) : out ? (
          <Button label="Watch the vote" onPress={() => castVote(null)} />
        ) : (
          <Button
            label="Lock in vote"
            disabled={!selected}
            onPress={() => selected && castVote(selected)}
          />
        )}
        <ThemedText type="small" themeColor="textMuted" style={styles.note}>
          {votesIn
            ? 'You cannot change your vote.'
            : out
              ? 'Eliminated players do not get a vote.'
              : 'Nobody sees the tally until you lock in.'}
        </ThemedText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  prompt: {
    paddingBottom: Spacing.three,
  },
  content: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  footer: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  note: {
    textAlign: 'center',
  },
});
