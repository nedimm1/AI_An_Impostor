import { ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { DEFAULT_SETTINGS } from '@/game/types';

const { turnsEach, answerSeconds, tiebreakerTurns, tiebreakerTurnsAccused } = DEFAULT_SETTINGS;

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
    title:
      turnsEach === 1
        ? `One go each, ${answerSeconds} seconds a turn`
        : `${turnsEach} goes each, ${answerSeconds} seconds a turn`,
    body:
      turnsEach === 1
        ? `Everyone answers the prompt once, in turn. You get ${answerSeconds} seconds — the only clock in the game. Run out and that turn passes empty.`
        : `Talk goes round the room ${turnsEach} times on the same prompt, so you can react to what people said. Each turn gives you ${answerSeconds} seconds — the only clock in the game. Run out and that turn passes empty.`,
  },
  {
    title: 'Then the room votes',
    body: 'Once everyone has answered you all vote for who you think the impostor is. The most-voted player is out.',
  },
  {
    title: 'A tie means a tiebreaker',
    body: `If the vote ties, the whole room talks it out. The players it tied on go first and get ${tiebreakerTurnsAccused} messages each; everyone else gets ${tiebreakerTurns}. Then the room votes again. It is usually one of them, but the ballot stays open — if you think they are both innocent you can still name somebody else. Tie again and nobody goes out — and a round nobody used is a round the impostor survived.`,
  },
  {
    title: 'It runs until someone wins',
    body: 'Vote the impostor out and the humans win. Let it whittle you down to one human, or let it sit through every round uncaught, and it wins instead.',
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
