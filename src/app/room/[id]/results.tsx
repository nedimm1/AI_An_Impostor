import { Redirect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { humansAlive, playerById, survivors, voteTally, YOU_ID } from '@/game/types';
import { useCountdown } from '@/hooks/use-countdown';
import { useLeaveGame } from '@/hooks/use-leave-game';

/**
 * What the round's vote did. Either the match is decided and the impostor is
 * revealed, or someone is gone and the room goes again.
 */
export default function ResultsScreen() {
  const router = useRouter();
  const { room, nextRound, spectate, leaveRoom } = useRoomStore();

  const decided = room?.outcome != null;
  const youWereVotedOut = room?.eliminatedId === YOU_ID;

  // A round result is a beat, not a decision: it runs out on its own and the
  // room goes again. Being voted out is the one screen that waits, because
  // watching on or walking away is a choice only you can make.
  const autoAdvances = room !== null && !decided && !youWereVotedOut;

  const handleLeave = useLeaveGame(!decided);

  // Fixed on mount — the screen is remounted for each round, so the clock does
  // not need resetting between them.
  const [deadline] = useState(
    () => Date.now() + (room?.settings.resultSeconds ?? 0) * 1000
  );

  const goToRound = useCallback(() => {
    if (!room) return;
    nextRound();
    router.replace({ pathname: '/room/[id]/round', params: { id: room.id } });
  }, [room, nextRound, router]);

  const remaining = useCountdown(autoAdvances ? deadline : null, goToRound);

  if (!room) return <Redirect href="/" />;

  const eliminated = playerById(room, room.eliminatedId);
  const impostor = playerById(room, room.impostorId);
  const yourVote = playerById(room, room.votes[YOU_ID]);
  const tally = voteTally(room);

  // A ballot can close with nothing in it — everyone let their clock run out
  // without naming anybody. That is a different result from a tie, and the
  // room should be told which one it got.
  const nobodyVoted = Object.keys(room.votes).length === 0;
  const humansWon = room.outcome === 'humans';

  const handleKeepWatching = () => {
    spectate();
    goToRound();
  };

  const handlePlayAgain = () => {
    leaveRoom();
    router.replace('/queue');
  };

  return (
    <Screen>
      <ScreenHeader
        title={`Round ${room.round}`}
        subtitle={decided ? 'Match over' : `${survivors(room).length} still in`}
        onBack={handleLeave}
        right={
          decided ? (
            <Pill
              label={humansWon ? 'Humans win' : 'Impostor wins'}
              tone={humansWon ? 'success' : 'danger'}
            />
          ) : undefined
        }
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {decided ? (
          <View style={[styles.reveal, humansWon ? styles.revealCaught : styles.revealEscaped]}>
            <ThemedText type="label" themeColor={humansWon ? 'success' : 'danger'}>
              The impostor was
            </ThemedText>

            {impostor ? (
              <>
                <Avatar
                  id={impostor.id}
                  name={impostor.name}
                  size={72}
                  ringColor={humansWon ? Colors.success : Colors.danger}
                />
                <ThemedText type="title">{impostor.name}</ThemedText>
              </>
            ) : (
              <ThemedText type="title">Unknown</ThemedText>
            )}

            <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
              {humansWon
                ? 'The room voted it out.'
                : humansAlive(room) <= 1
                  ? `Only ${humansAlive(room)} human left. It cannot be outvoted now.`
                  : `It sat through all ${room.settings.maxRounds} rounds without being caught.`}
            </ThemedText>
          </View>
        ) : (
          <View style={styles.roundBlock}>
            {eliminated ? (
              <>
                <Avatar id={eliminated.id} name={eliminated.name} size={64} dimmed />
                <ThemedText type="title">
                  {youWereVotedOut ? 'You were voted out' : `${eliminated.name} is out`}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                  {youWereVotedOut
                    ? 'You were not the impostor. It is still in the room.'
                    : `${eliminated.name} was not the impostor. It is still in the room.`}
                </ThemedText>
              </>
            ) : (
              <>
                <ThemedText type="title">
                  {nobodyVoted ? 'Nobody voted for anybody' : 'Nobody is out'}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                  {nobodyVoted
                    ? 'The ballot closed empty. The round is spent and everyone stays in.'
                    : room.tiebreaker
                      ? 'The tiebreaker was tied too. The round is spent and everyone stays in.'
                      : 'The vote was split with nobody ahead, so everyone stays in.'}
                </ThemedText>
              </>
            )}
          </View>
        )}

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
          {nobodyVoted ? (
            <View style={styles.tallyRow}>
              <ThemedText type="small" themeColor="textMuted">
                No votes were cast.
              </ThemedText>
            </View>
          ) : null}
          {room.players.map((player, i) => {
            const count = tally[player.id] ?? 0;
            return (
              <View key={player.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.tallyRow}>
                  <Avatar
                    id={player.id}
                    name={player.name}
                    size={32}
                    dimmed={player.eliminated || !player.connected || count === 0}
                  />
                  <ThemedText
                    type="body"
                    style={[
                      styles.tallyName,
                      (player.eliminated || !player.connected) && styles.struck,
                    ]}
                    numberOfLines={1}>
                    {player.name}
                  </ThemedText>
                  {!player.connected ? (
                    <Pill label="Left" />
                  ) : player.eliminated ? (
                    <Pill label="Out" />
                  ) : null}
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
        {decided ? (
          <>
            <Button label="Find another game" onPress={handlePlayAgain} />
            <Button label="Leave" variant="ghost" onPress={handleLeave} />
          </>
        ) : youWereVotedOut ? (
          <>
            <Button label="Keep watching" onPress={handleKeepWatching} />
            <Button label="Leave the game" variant="ghost" onPress={handleLeave} />
          </>
        ) : (
          <>
            <ThemedText type="small" themeColor="textMuted" style={styles.centered}>
              {`Round ${room.round + 1} starts in ${remaining ?? 0}s`}
            </ThemedText>
            {/* Runs down rather than fills up — the room is being given back,
                not made to wait for something. */}
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${
                      Math.max(
                        0,
                        Math.min(1, (remaining ?? 0) / room.settings.resultSeconds)
                      ) * 100
                    }%`,
                  },
                ]}
              />
            </View>
            <Button label="Leave the game" variant="ghost" onPress={handleLeave} />
          </>
        )}
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
  roundBlock: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  centered: {
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
  struck: {
    color: Colors.textMuted,
    textDecorationLine: 'line-through',
  },
  track: {
    height: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.backgroundSelected,
    overflow: 'hidden',
    marginTop: Spacing.one,
    marginBottom: Spacing.one,
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
  },
  footer: {
    gap: Spacing.one,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
