import { Redirect, useRouter } from 'expo-router';
import { Fragment, useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, Divider } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';
import { humansAlive, playerById, survivors, voteTally } from '@/game/types';
import { useCountdown } from '@/hooks/use-countdown';
import { useLeaveGame } from '@/hooks/use-leave-game';

/**
 * What the round's vote did. Either the match is decided and the impostor is
 * revealed, or someone is gone and the room goes again.
 */
export default function ResultsScreen() {
  const router = useRouter();
  const { room, send } = useRoomStore();

  const decided = room?.outcome != null;
  const youWereVotedOut = room != null && room.eliminatedId === room.youId;

  // The room's clock, not this screen's. A round result is a beat that runs out
  // on its own; being voted out is the one that waits, and the room knows that
  // too — it simply stops counting down.
  const deadline = room?.verdictEndsAt ?? null;
  const autoAdvances = deadline !== null;

  const handleLeave = useLeaveGame(!decided);

  // The room going again is what moves this screen on, not the other way
  // round. Whether that came from the clock running out or from you saying you
  // would keep watching, it arrives here the same way.
  const roomId = room?.id;
  const phase = room?.phase;
  useEffect(() => {
    if (phase === 'answering' && roomId) {
      router.replace({ pathname: '/room/[id]/round', params: { id: roomId } });
    }
  }, [phase, roomId, router]);

  const remaining = useCountdown(deadline);

  // The label counts in whole seconds, but the track should not step with it.
  // One timing animation runs the whole remaining stretch on the UI thread, so
  // the bar slides down evenly instead of chipping away once a second.
  const progress = useSharedValue(1);

  useEffect(() => {
    if (!autoAdvances) return;
    if (deadline === null) return;
    const left = deadline - Date.now();
    if (left <= 0) {
      progress.value = 0;
      return;
    }
    progress.value = 1;
    progress.value = withTiming(0, { duration: left, easing: Easing.linear });
  }, [autoAdvances, deadline, progress]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  if (!room) return <Redirect href="/" />;

  const eliminated = playerById(room, room.eliminatedId);
  const impostor = playerById(room, room.impostorId);
  const yourVote = playerById(room, room.votes[room.youId]);
  const tally = voteTally(room);

  // A ballot can close with nothing in it — everyone let their clock run out
  // without naming anybody. That is a different result from a tie, and the
  // room should be told which one it got.
  const nobodyVoted = Object.keys(room.votes).length === 0;
  const humansWon = room.outcome === 'humans';

  // A tie that is about to become a tiebreaker, rather than one that spent the
  // round. The two are told apart by whether there is anything to go into.
  const tiedUp = (room.pendingTiebreaker ?? [])
    .map((id) => playerById(room, id))
    .filter((p): p is NonNullable<typeof p> => p != null);

  const handleKeepWatching = () => send({ type: 'spectate' });

  const handlePlayAgain = () => {
    send({ type: 'leave' });
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
            {tiedUp.length >= 2 ? (
              <>
                <View style={styles.tiedPair}>
                  {tiedUp.map((p, i) => (
                    <Fragment key={p.id}>
                      {i > 0 ? (
                        <ThemedText type="label" themeColor="textMuted" style={styles.tiedAnd}>
                          vs
                        </ThemedText>
                      ) : null}
                      <View style={styles.tiedSeat}>
                        <Avatar
                          id={p.id}
                          name={p.name}
                          tint={p.tint}
                          size={64}
                          ringColor={Colors.warning}
                        />
                        <ThemedText type="small" numberOfLines={1}>
                          {p.isYou ? 'You' : p.name}
                        </ThemedText>
                      </View>
                    </Fragment>
                  ))}
                </View>

                <ThemedText type="title">The room is split</ThemedText>

                <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
                  {tiedUp.some((p) => p.isYou)
                    ? 'Nobody is out. You and the other one go again — say why it is not you, then the room votes between you.'
                    : 'Nobody is out. These two go again, then the room votes between them.'}
                </ThemedText>
              </>
            ) : eliminated ? (
              <>
                <Avatar
                  id={eliminated.id}
                  name={eliminated.name}
                  tint={eliminated.tint}
                  size={64}
                  dimmed
                />
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
              <Animated.View style={[styles.fill, fillStyle]} />
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
  /* The two a tie put up, side by side, because that is what a tie looks like. */
  tiedPair: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  tiedSeat: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  tiedAnd: {
    // Level with the faces rather than the names below them.
    marginTop: Spacing.five,
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
