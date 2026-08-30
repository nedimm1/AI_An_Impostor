import { Link, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Colors, Radius, Spacing } from '@/constants/theme';

/** Decorative lineup — five "players", one of which is unreadable. */
const LINEUP = [
  { id: 'lineup-a', name: 'Mara' },
  { id: 'lineup-b', name: 'Deniz' },
  { id: 'lineup-c', name: '??' },
  { id: 'lineup-d', name: 'Kofi' },
  { id: 'lineup-e', name: 'Sasha' },
];

export default function HomeScreen() {
  const router = useRouter();

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.lineup}>
          {LINEUP.map((p, i) =>
            i === 2 ? (
              <View key={p.id} style={styles.impostorSlot}>
                <ThemedText type="subtitle" style={styles.impostorGlyph}>
                  ?
                </ThemedText>
              </View>
            ) : (
              <Avatar key={p.id} id={p.id} name={p.name} size={44} />
            )
          )}
        </View>

        <View style={styles.wordmark}>
          <ThemedText type="display" style={styles.title}>
            An Impostor
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.tagline}>
            Six people in a chatroom. One of them isn&apos;t a person. Find it before the rounds run
            out.
          </ThemedText>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label="Create a room" onPress={() => router.push('/create')} />
        <Button label="Join with a code" variant="secondary" onPress={() => router.push('/join')} />

        <View style={styles.footerLinks}>
          <Link href="/how-to-play" asChild>
            <Pressable hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                How to play
              </ThemedText>
            </Pressable>
          </Link>

          <View style={styles.dot} />

          <Link href="/settings" asChild>
            <Pressable hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Settings
              </ThemedText>
            </Pressable>
          </Link>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.five,
  },
  lineup: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  impostorSlot: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.dangerMuted,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  impostorGlyph: {
    color: Colors.danger,
  },
  wordmark: {
    gap: Spacing.three,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
    maxWidth: 340,
  },
  actions: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.textMuted,
  },
  pressed: {
    opacity: 0.6,
  },
});
