import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { colorForId, Colors, Radius, Spacing } from '@/constants/theme';
import type { Message, Player } from '@/game/types';

type ChatBubbleProps = {
  message: Message;
  author?: Player;
  /** False when the previous message came from the same author. */
  showAuthor: boolean;
};

export function ChatBubble({ message, author, showAuthor }: ChatBubbleProps) {
  if (message.kind === 'system') {
    return (
      <View style={styles.systemRow}>
        <ThemedText type="small" themeColor="textMuted" style={styles.systemText}>
          {message.text}
        </ThemedText>
      </View>
    );
  }

  const isYou = author?.isYou ?? false;

  if (isYou) {
    return (
      <View style={[styles.row, styles.rowOwn]}>
        <View style={[styles.bubble, styles.bubbleOwn]}>
          <ThemedText type="body" style={styles.ownText}>
            {message.text}
          </ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.row, !showAuthor && styles.rowStacked]}>
      <View style={styles.gutter}>
        {showAuthor && author ? <Avatar id={author.id} name={author.name} size={30} /> : null}
      </View>

      <View style={styles.bubbleColumn}>
        {showAuthor && author ? (
          <ThemedText type="label" style={{ color: colorForId(author.id) }}>
            {author.name}
          </ThemedText>
        ) : null}
        <View style={styles.bubble}>
          <ThemedText type="body">{message.text}</ThemedText>
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
  rowStacked: {
    marginTop: Spacing.one,
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
  ownText: {
    color: Colors.textOnAccent,
  },
  systemRow: {
    alignItems: 'center',
    marginTop: Spacing.four,
  },
  systemText: {
    textAlign: 'center',
  },
});
