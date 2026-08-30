import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';

const STEPS = [
  {
    title: 'Everyone joins the same room',
    body: 'The host shares a four-letter code. Five to ten players per room.',
  },
  {
    title: 'One of them is not a person',
    body: 'Every round the group gets a prompt and talks it out in the chat. One participant is a model pretending to be one of you.',
  },
  {
    title: 'Talk, then vote',
    body: 'When the timer runs out everyone locks in a vote for who they think is the impostor. Nobody sees the tally until voting closes.',
  },
  {
    title: 'Nobody has to lie',
    body: 'Unlike other social deduction games, every human here is just being themselves. The only liar in the room is the machine.',
  },
];

export default function HowToPlayScreen() {
  return (
    <Screen>
      <ScreenHeader title="How to play" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {STEPS.map((step, i) => (
          <Card key={step.title}>
            <View style={styles.step}>
              <View style={styles.badge}>
                <ThemedText type="smallBold" style={styles.badgeText}>
                  {i + 1}
                </ThemedText>
              </View>
              <View style={styles.stepBody}>
                <ThemedText type="bodyBold">{step.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {step.body}
                </ThemedText>
              </View>
            </View>
          </Card>
        ))}

        <ThemedText type="small" themeColor="textMuted" style={styles.note}>
          Rules will change as game modes get built out.
        </ThemedText>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.two,
    paddingBottom: Spacing.four,
  },
  step: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  badge: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accentMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: Colors.accent,
  },
  stepBody: {
    flex: 1,
    gap: Spacing.one,
  },
  note: {
    textAlign: 'center',
    paddingTop: Spacing.three,
  },
});
