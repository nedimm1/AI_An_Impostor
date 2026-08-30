import { Redirect, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Divider } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';
import { playerById, voteTally, votedOutId, YOU_ID } from '@/game/types';

export default function ResultsScreen() {
  const router = useRouter();
  const { room, nextRound, backToLobby, leaveRoom } = useRoomStore();

  if (!room) return <Redirect href="/" />;

  const impostor = playerById(room, room.impostorId);
  const eliminated = votedOutId(room);
  const caught = eliminated !== null && eliminated === room.impostorId;
  const yourVote = playerById(room, room.votes[YOU_ID]);
  const tally = voteTally(room);
  const hasMoreRounds = room.round < room.settings.rounds;

  const handleNextRound = () => {
    nextRound();
    router.replace({ pathname: '/room/[code]/chat', params: { code: room.code } });
  };

  const handleBackToLobby = () => {
    backToLobby();
    router.replace({ pathname: '/room/[code]', params: { code: room.code } });
  };

  const handleLeave = () => {
    leaveRoom();
    router.replace('/');
  };

  return (
    <Screen>
      <ScreenHeader
        title={`Round ${room.round}`}
        subtitle={`of ${room.settings.rounds}`}
        onBack={handleLeave}
        right={
          <Pill
            label={caught ? 'Humans win' : 'Impostor survives'}
            tone={caught ? 'success' : 'danger'}
          />
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.reveal, caught ? styles.revealCaught : styles.revealEscaped]}>
          <ThemedText type="label" themeColor={caught ? 'success' : 'danger'}>
            The impostor was
          </ThemedText>

          {impostor ? (
            <>
              <Avatar
                id={impostor.id}
                name={impostor.name}
                size={72}
                ringColor={caught ? Colors.success : Colors.danger}
              />
              <ThemedText type="title">{impostor.name}</ThemedText>
            </>
          ) : (
            <ThemedText type="title">Unknown</ThemedText>
          )}

          <ThemedText type="small" themeColor="textSecondary" style={styles.revealNote}>
            {eliminated === null
              ? 'The vote was tied, so nobody was eliminated.'
              : caught
                ? 'The group voted it out.'
                : `The group voted out ${playerById(room, eliminated)?.name ?? 'someone else'}.`}
          </ThemedText>
        </View>

        {yourVote ? (
          <Card>
            <View style={styles.yourVote}>
              <ThemedText type="body" themeColor="textSecondary">
                You voted for
              </ThemedText>
              <View style={styles.yourVoteName}>
                <Avatar id={yourVote.id} name={yourVote.name} size={26} />
                <ThemedText type="bodyBold">{yourVote.name}</ThemedText>
              </View>
            </View>
          </Card>
        ) : null}

        <Card title="Where the votes went" padded={false}>
          {room.players.map((player, i) => {
            const count = tally[player.id] ?? 0;
            return (
              <View key={player.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.tallyRow}>
                  <Avatar id={player.id} name={player.name} size={32} dimmed={count === 0} />
                  <ThemedText type="body" style={styles.tallyName} numberOfLines={1}>
                    {player.name}
                  </ThemedText>
                  <ThemedText type="mono" themeColor={count > 0 ? 'text' : 'textMuted'}>
                    {count}
                  </ThemedText>
                </View>
              </View>
            );
          })}
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        {hasMoreRounds ? (
          <Button label={`Start round ${room.round + 1}`} onPress={handleNextRound} />
        ) : (
          <Button label="Back to lobby" onPress={handleBackToLobby} />
        )}
        <Button label="Leave room" variant="ghost" onPress={handleLeave} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    paddingBottom: Spacing.four,
  },
  reveal: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.xl,
    borderWidth: 1,
  },
  revealCaught: {
    backgroundColor: Colors.successMuted,
    borderColor: Colors.success + '44',
  },
  revealEscaped: {
    backgroundColor: Colors.dangerMuted,
    borderColor: Colors.danger + '44',
  },
  revealNote: {
    textAlign: 'center',
  },
  yourVote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yourVoteName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  tallyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  tallyName: {
    flex: 1,
  },
  footer: {
    gap: Spacing.one,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
