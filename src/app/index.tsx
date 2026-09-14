import { Link, useRouter } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { countWord, DEFAULT_SETTINGS } from '@/game/types';

/**
 * The mark: a ring of misters around the one that is not a person. It took the
 * place of a row of seat avatars with a question mark in the middle, which was
 * the same idea drawn by hand.
 *
 * The PNG's black ground is blended into `Colors.background` when the asset is
 * made, so it sits on the page without a visible square. Replace the file with
 * one that has a different ground and that edge will show.
 */
const LOGO = require('../../assets/images/logo.png');

/** Wide enough to read the robot in the middle, narrow enough to leave the wordmark room. */
const LOGO_SIZE = 220;

export default function HomeScreen() {
  const router = useRouter();
  // Nothing stands between the button and the queue. There is no name to pick
  // — the room deals you one when it seats you (`seats.ts`).
  const handlePlay = () => router.push('/queue');

  return (
    <Screen>
      <View style={styles.hero}>
        <Image
          source={LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel="An Impostor"
        />

        <View style={styles.wordmark}>
          <ThemedText type="display" style={styles.title}>
            An Impostor
          </ThemedText>
          <ThemedText type="body" themeColor="textSecondary" style={styles.tagline}>
            You and {countWord(DEFAULT_SETTINGS.playerCount - 1)} strangers in a chatroom. One of
            them isn&apos;t a person. Vote it out before it outlasts you.
          </ThemedText>
        </View>
      </View>

      <View style={styles.actions}>
        <Button label="Find a game" onPress={handlePlay} />

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
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    maxWidth: '100%',
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
