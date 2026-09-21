import { Link, useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { RoomSizePicker } from '@/components/game/room-size-picker';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';

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
const LOGO_SIZE = 270;

export default function HomeScreen() {
  const router = useRouter();
  const { roomSize, setRoomSize, notice, dismissNotice } = useRoomStore();
  // The size is picked right here, so the button goes straight to the queue.
  // There is no name to pick either — the room deals one when it seats you.
  const handlePlay = () => router.push('/queue');

  return (
    <Screen>
      <View style={styles.body}>
        {/* The one way off this screen that is not playing. It floats in the
          corner, over the logo's own empty corner rather than in a row of its
          own, so the logo can sit right up at the top. */}
        <View style={styles.topBar}>
          <CornerLink
            href="/how-to-play"
            label="How to play"
            symbol={{
              ios: 'questionmark',
              android: 'question_mark',
              web: 'question_mark',
            }}
          />
        </View>

        <View style={styles.hero}>
          <Image
            source={LOGO}
            style={styles.logo}
            resizeMode="contain"
            accessibilityRole="image"
            accessibilityLabel="AI: An Impostor"
          />

          <View style={styles.wordmark}>
            {/* A touch under the display size so the full title stays on one line
              on a small phone: wrapped after "AI:" it reads as two things. */}
            <ThemedText type="display" style={styles.title}>
              <ThemedText type="display" style={styles.titleAccent}>
                AI:
              </ThemedText>{' '}
              An Impostor
            </ThemedText>
            {/* One line. The rest of the pitch — the chat, the vote — is what the
              picker and the game itself say; a paragraph here was just the gap
              between the logo and the button made longer. */}
            <ThemedText type="subtitle" themeColor="textSecondary" style={styles.tagline}>
              One of the strangers isn&apos;t a person.
            </ThemedText>
          </View>
        </View>

        {/* The button straight under the picker, and the whole stack centred on
          the screen, so the leftover height is split above and below it. */}
        <View style={styles.actions}>
          <View style={styles.choices}>
            {notice === 'removedForBeingAway' ? (
              // Landing back on the home screen mid-match with no explanation reads
              // as the app having crashed. This says what actually happened.
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Dismiss"
                onPress={dismissNotice}
                style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
                <ThemedText type="smallBold">You were away too long</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Your connection was gone for too long, so the match carried on without you. Tap to
                  dismiss.
                </ThemedText>
              </Pressable>
            ) : notice === 'leftEarlyWarning' || notice === 'leftEarlyCooldown' ? (
              // Said once, right after leaving, so the wait on the next search is
              // not a surprise (server/game/penalties.ts).
              <Pressable
                accessibilityRole="button"
                accessibilityHint="Dismiss"
                onPress={dismissNotice}
                style={({ pressed }) => [styles.notice, pressed && styles.pressed]}>
                <ThemedText type="smallBold">You left a match early</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {notice === 'leftEarlyWarning'
                    ? 'The others were still playing. Next time you leave early you will have to wait before joining another match.'
                    : 'The others were still playing, so you will have to wait a little before joining another match.'}{' '}
                  Tap to dismiss.
                </ThemedText>
              </Pressable>
            ) : null}
            <RoomSizePicker value={roomSize} onChange={setRoomSize} />
          </View>
          <Button label="Find a game" onPress={handlePlay} />
        </View>
      </View>
    </Screen>
  );
}

/** A round icon button in the top bar. */
function CornerLink({
  href,
  label,
  symbol,
}: {
  href: '/how-to-play';
  label: string;
  symbol: SymbolViewProps['name'];
}) {
  return (
    <Link href={href} asChild>
      {/* The circle is its own view: `Link asChild` hands the Pressable a style
          of its own, and a style function on it was being dropped. */}
      <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8}>
        {({ pressed }) => (
          <View style={[styles.cornerButton, pressed && styles.pressed]}>
            <SymbolView name={symbol} size={20} tintColor={Colors.textSecondary} />
          </View>
        )}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  topBar: {
    position: 'absolute',
    top: Spacing.two,
    left: 0,
    right: 0,
    zIndex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cornerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
  },
  hero: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
    maxWidth: '100%',
  },
  wordmark: {
    gap: Spacing.two,
    alignItems: 'center',
  },
  title: {
    textAlign: 'center',
    fontSize: 40,
    lineHeight: 44,
  },
  titleAccent: {
    color: Colors.accentText,
  },
  tagline: {
    textAlign: 'center',
    maxWidth: 340,
  },
  actions: {
    gap: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  choices: {
    gap: Spacing.three,
  },
  notice: {
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.warning,
    backgroundColor: Colors.warningMuted,
  },
  pressed: {
    opacity: 0.6,
  },
});
