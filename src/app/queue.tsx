import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';

/**
 * The queue. You wait here until the matchmaker has seated a full room, then
 * drop straight into round one — there is no lobby and nobody to invite.
 */
export default function QueueScreen() {
  const router = useRouter();
  const { matchmaking, findMatch, room, send, roomSize } = useRoomStore();

  // Asking to be seated is all this screen does. Who the strangers are, how
  // long they take and when the room opens are not its business.
  useEffect(() => findMatch(roomSize), [findMatch, roomSize]);

  // The room turning up is the only signal that the wait is over.
  const roomId = room?.id;
  useEffect(() => {
    if (roomId) {
      router.replace({ pathname: '/room/[id]/round', params: { id: roomId } });
    }
  }, [roomId, router]);

  // Left a match early (server/game/penalties.ts): the server said wait. Count
  // it down, and ask again the moment it is over.
  const cooldownEndsAt = matchmaking?.cooldownEndsAt ?? null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (cooldownEndsAt === null) return;
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, [cooldownEndsAt]);
  const cooldownLeft = cooldownEndsAt === null ? 0 : Math.max(0, cooldownEndsAt - now);
  const coolingDown = cooldownLeft > 0;
  useEffect(() => {
    if (cooldownEndsAt !== null && !coolingDown) findMatch(roomSize);
  }, [cooldownEndsAt, coolingDown, findMatch, roomSize]);

  const found = matchmaking?.found ?? 1;
  // Counted in people, not seats — the impostor's seat is never waited for.
  const total = matchmaking?.total ?? roomSize - 1;

  const handleCancel = () => {
    // Out of the queue, not just off the screen. Online, leaving the screen
    // alone would leave you queued on the server and matched into a room you
    // are no longer looking at. On one device there is no room yet and this
    // does nothing.
    send({ type: 'leave' });
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen>
      <View style={styles.body}>
        {coolingDown ? null : (
          <View style={styles.spinnerRing}>
            <ActivityIndicator size="large" color={Colors.accent} />
          </View>
        )}

        {coolingDown ? (
          <View style={styles.copy}>
            <ThemedText type="subtitle" style={styles.centered}>
              You left a match early
            </ThemedText>
            <ThemedText type="body" themeColor="textSecondary" style={styles.centered}>
              You can play again in {clock(cooldownLeft)}
            </ThemedText>
            <ThemedText type="small" themeColor="textMuted" style={[styles.centered, styles.note]}>
              Other people were still playing. Finishing a match takes one of these off your record.
            </ThemedText>
          </View>
        ) : (
          <>
            <View style={styles.copy}>
              <ThemedText type="subtitle" style={styles.centered}>
                Searching for players…
              </ThemedText>
              <ThemedText type="body" themeColor="textSecondary" style={styles.centered}>
                {found} of {total} found
              </ThemedText>
            </View>

            <View style={styles.seats}>
              {Array.from({ length: total }, (_, i) => (
                <View key={i} style={[styles.seat, i < found && styles.seatFilled]} />
              ))}
            </View>

            <ThemedText type="small" themeColor="textMuted" style={[styles.centered, styles.note]}>
              You&apos;ll be dropped in with strangers. One of them won&apos;t be a person.
            </ThemedText>
          </>
        )}
      </View>

      <View style={styles.footer}>
        <Button label="Cancel" variant="ghost" onPress={handleCancel} />
      </View>
    </Screen>
  );
}

/** 4:05, the way a countdown reads. */
function clock(ms: number) {
  const seconds = Math.ceil(ms / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  spinnerRing: {
    width: 96,
    height: 96,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentMuted,
    borderWidth: 1,
    borderColor: Colors.accent + '44',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    gap: Spacing.one,
  },
  centered: {
    textAlign: 'center',
  },
  seats: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  seat: {
    width: 10,
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.backgroundSelected,
  },
  seatFilled: {
    backgroundColor: Colors.accent,
  },
  note: {
    maxWidth: 300,
    paddingTop: Spacing.two,
  },
  footer: {
    paddingBottom: Spacing.two,
  },
});
