import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { colorForId, Colors, Radius, Spacing } from '@/constants/theme';
import type { Answer, Player } from '@/game/types';

type AnswerBubbleProps = {
  answer: Answer;
  author?: Player;
};

/** One player's answer to the round's prompt. */
export function AnswerBubble({ answer, author }: AnswerBubbleProps) {
  const isYou = author?.isYou ?? false;
  const body = answer.timedOut ? 'ran out of time' : answer.text;

  if (isYou) {
    return (
      <View style={[styles.row, styles.rowOwn]}>
        <View style={styles.bubbleColumn}>
          <ThemedText type="label" style={styles.ownLabel}>
            You
          </ThemedText>
          <View style={[styles.bubble, styles.bubbleOwn, answer.timedOut && styles.bubbleSilent]}>
            <ThemedText
              type="body"
              style={answer.timedOut ? styles.silentText : styles.ownText}>
              {body}
            </ThemedText>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.gutter}>
        {author ? <Avatar id={author.id} name={author.name} size={30} /> : null}
      </View>

      <View style={styles.bubbleColumn}>
        {author ? (
          <ThemedText type="label" style={{ color: colorForId(author.id) }}>
            {author.name}
          </ThemedText>
        ) : null}
        <View style={[styles.bubble, answer.timedOut && styles.bubbleSilent]}>
          <ThemedText type="body" style={answer.timedOut ? styles.silentText : undefined}>
            {body}
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
    alignItems: 'flex-start',
  },
  rowOwn: {
    justifyContent: 'flex-end',
  },
  gutter: {
    width: 30,
  },
  bubbleColumn: {
    flexShrink: 1,
    gap: Spacing.one,
    alignItems: 'flex-start',
  },
  ownLabel: {
    color: Colors.accent,
    alignSelf: 'flex-end',
  },
  bubble: {
    backgroundColor: Colors.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    borderTopLeftRadius: Radius.sm,
    paddingHorizontal: Spacing.three,
    paddingVertical: 10,
    maxWidth: '100%',
  },
  bubbleOwn: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    borderTopLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.sm,
    maxWidth: '82%',
  },
  /** A turn that expired with nothing typed. */
  bubbleSilent: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: Colors.border,
  },
  ownText: {
    color: Colors.textOnAccent,
  },
  silentText: {
    color: Colors.textMuted,
    fontStyle: 'italic',
  },
});
