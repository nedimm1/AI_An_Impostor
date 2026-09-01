import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';

const STEPS = [
  {
    title: 'You get matched with strangers',
    body: 'Tap find a game and the matchmaker seats you in a chatroom with five people you have never met. Nothing to create, nobody to invite.',
  },
  {
    title: 'One of them is not a person',
    body: 'The room gets a prompt and answers it one at a time. One participant is a model pretending to be one of you.',
  },
  {
    title: 'Three goes each, a minute at a time',
    body: 'Talk goes round the room three times on the same prompt, so you can react to what people said. Each turn gives you sixty seconds — the only clock in the game. Run out and that turn passes empty.',
  },
  {
    title: 'Then the room votes',
    body: 'Once everyone has answered you all vote for who you think the impostor is. The most-voted player is out. A tie removes nobody.',
  },
  {
    title: 'It runs until someone wins',
    body: 'There is no set number of rounds. Vote the impostor out and the humans win. Let it whittle you down to one human and it wins instead.',
  },
  {
    title: 'Nobody has to lie',
    body: 'Unlike other social deduction games, every human here is a stranger just being themselves. The only liar in the room is the machine.',
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
