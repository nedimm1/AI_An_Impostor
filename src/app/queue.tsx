import { useRouter } from 'expo-router';
import { useEffect } from 'react';
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
  const { matchmaking, findMatch, room } = useRoomStore();

  // Asking to be seated is all this screen does. Who the strangers are, how
  // long they take and when the room opens are not its business.
  useEffect(findMatch, [findMatch]);

  // The room turning up is the only signal that the wait is over.
  const roomId = room?.id;
  useEffect(() => {
    if (roomId) {
      router.replace({ pathname: '/room/[id]/round', params: { id: roomId } });
    }
  }, [roomId, router]);

  const found = matchmaking?.found ?? 1;
  const total = matchmaking?.total ?? 7;

  const handleCancel = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <Screen>
      <View style={styles.body}>
        <View style={styles.spinnerRing}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>

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
      </View>

      <View style={styles.footer}>
        <Button label="Cancel" variant="ghost" onPress={handleCancel} />
      </View>
    </Screen>
  );
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
