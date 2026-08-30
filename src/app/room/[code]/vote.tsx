import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { VoteRow } from '@/components/game/vote-row';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Pill } from '@/components/ui/pill';
import { Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';
import { voteTally, YOU_ID } from '@/game/types';
import { formatClock, useCountdown } from '@/hooks/use-countdown';

export default function VoteScreen() {
  const router = useRouter();
  const { room, castVote, reveal } = useRoomStore();
  const [selected, setSelected] = useState<string | null>(null);

  const phase = room?.phase;
  const code = room?.code;

  const goToResults = useCallback(() => {
    if (!code) return;
    reveal();
    router.replace({ pathname: '/room/[code]/results', params: { code } });
  }, [code, reveal, router]);

  const onTimeUp = useCallback(() => {
    if (phase === 'voting') goToResults();
  }, [phase, goToResults]);

  const remaining = useCountdown(room?.phaseEndsAt ?? null, onTimeUp);

  if (!room) return <Redirect href="/" />;

  const hasVoted = room.votes[YOU_ID] !== undefined;
  const tally = voteTally(room);

  return (
    <Screen>
      <ScreenHeader
        title="Who is the impostor?"
        subtitle={hasVoted ? 'Votes are in' : 'Pick one player'}
        right={
          remaining !== null ? (
            <Pill label={formatClock(remaining)} tone={remaining <= 10 ? 'danger' : 'neutral'} />
          ) : undefined
        }
      />

      {room.prompt ? (
        <ThemedText type="small" themeColor="textMuted" style={styles.prompt}>
          Round {room.round}: {room.prompt}
        </ThemedText>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {room.players.map((player) => (
          <VoteRow
            key={player.id}
            player={player}
            selected={hasVoted ? room.votes[YOU_ID] === player.id : selected === player.id}
            voteCount={hasVoted ? (tally[player.id] ?? 0) : undefined}
            disabled={player.isYou || hasVoted}
            dimmed={player.isYou}
            onPress={() => setSelected(player.id)}
          />
        ))}
      </ScrollView>

      <View style={styles.footer}>
        {hasVoted ? (
          <Button label="See the reveal" onPress={goToResults} />
        ) : (
          <Button
            label="Lock in vote"
            disabled={!selected}
            onPress={() => selected && castVote(selected)}
          />
        )}
        <ThemedText type="small" themeColor="textMuted" style={styles.note}>
          {hasVoted ? 'You cannot change your vote.' : 'Nobody sees the tally until you lock in.'}
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
