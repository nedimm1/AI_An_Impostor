import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { VerdictHero, VoteBreakdown } from '@/components/game/verdict';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';
import { survivors } from '@/game/types';
import { useCountdown } from '@/hooks/use-countdown';
import { useLeaveGame } from '@/hooks/use-leave-game';

/**
 * What the round's vote did. Either the match is decided and the impostor is
 * revealed, or someone is gone and the room goes again.
 *
 * This screen owns the clock and the buttons; what happened and how the vote
 * went are drawn by `VerdictHero` and `VoteBreakdown`.
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

  const humansWon = room.outcome === 'humans';
  // A tie heading into a tiebreaker is not a new round — the room goes again
  // on the same one.
  const nextUp = room.pendingTiebreaker ? 'The tiebreaker' : `Round ${room.round + 1}`;

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
        <VerdictHero room={room} />
        <VoteBreakdown room={room} />
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
              {`${nextUp} starts in ${remaining ?? 0}s`}
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
  centered: {
    textAlign: 'center',
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
