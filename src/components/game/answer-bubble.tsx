import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { colorForId, Colors, Radius, Spacing } from '@/constants/theme';
import type { Answer, Player } from '@/game/types';

type AnswerBubbleProps = {
  answer: Answer;
  author?: Player;
  /** The answer this one was written at, when it was a reply. */
  replyTo?: Answer;
  replyToAuthor?: Player;
  /** Long-pressing the bubble picks it as the thing you are replying to. */
  onReply?: () => void;
  /** True while this is the answer the composer is aimed at. */
  replySelected?: boolean;
};

/** The quoted answer a reply sits on top of, WhatsApp-style. */
function Quote({
  answer,
  author,
  onOwnBubble,
}: {
  answer: Answer;
  author?: Player;
  onOwnBubble: boolean;
}) {
  const color = author ? colorForId(author.id) : Colors.textSecondary;
  const accent = onOwnBubble ? 'rgba(255, 255, 255, 0.75)' : color;

  return (
    <View
      style={[styles.quote, onOwnBubble && styles.quoteOwn, { borderLeftColor: accent }]}>
      <ThemedText type="label" numberOfLines={1} style={{ color: accent }}>
        {author?.isYou ? 'You' : (author?.name ?? 'Someone')}
      </ThemedText>
      <ThemedText
        type="small"
        numberOfLines={2}
        style={onOwnBubble ? styles.quoteTextOwn : styles.quoteText}>
        {answer.timedOut ? 'ran out of time' : answer.text}
      </ThemedText>
    </View>
  );
}

/**
 * The affordance for writing back at an answer. Long-pressing the bubble does
 * the same thing, but nothing on screen says so — this is the discoverable one.
 */
function ReplyButton({
  onPress,
  name,
  selected,
}: {
  onPress: () => void;
  name: string;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Reply to ${name}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [
        styles.replyButton,
        selected && styles.replyButtonActive,
        pressed && styles.replyButtonPressed,
      ]}>
      {({ pressed }) => (
        <ThemedText
          style={[styles.replyGlyph, (selected || pressed) && styles.replyGlyphActive]}>
          {/* Variation selector keeps Android off the emoji glyph. */}
          {'\u21A9\uFE0E'}
        </ThemedText>
      )}
    </Pressable>
  );
}

/** One player's answer to the round's prompt. */
export function AnswerBubble({
  answer,
  author,
  replyTo,
  replyToAuthor,
  onReply,
  replySelected,
}: AnswerBubbleProps) {
  const isYou = author?.isYou ?? false;
  const body = answer.timedOut ? 'ran out of time' : answer.text;

  // A turn nobody wrote in is not something you can answer back to.
  const canReply = !!onReply && !answer.timedOut;

  const replyLabel = author?.isYou ? 'your own answer' : (author?.name ?? 'this answer');

  if (isYou) {
    return (
      <View style={[styles.row, styles.rowOwn]}>
        {canReply && onReply ? (
          <ReplyButton onPress={onReply} name={replyLabel} selected={replySelected} />
        ) : null}

        <View style={styles.bubbleColumn}>
          <ThemedText type="label" style={styles.ownLabel}>
            You
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityHint={canReply ? 'Long press to reply to this answer' : undefined}
            disabled={!canReply}
            onLongPress={onReply}
            delayLongPress={250}
            style={({ pressed }) => [
              styles.bubble,
              styles.bubbleOwn,
              answer.timedOut && styles.bubbleSilent,
              pressed && canReply && styles.bubblePressed,
            ]}>
            {replyTo ? <Quote answer={replyTo} author={replyToAuthor} onOwnBubble /> : null}
            <ThemedText
              type="body"
              style={answer.timedOut ? styles.silentText : styles.ownText}>
              {body}
            </ThemedText>
          </Pressable>
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
        <Pressable
          accessibilityRole="button"
          accessibilityHint={canReply ? 'Long press to reply to this answer' : undefined}
          disabled={!canReply}
          onLongPress={onReply}
          delayLongPress={250}
          style={({ pressed }) => [
            styles.bubble,
            answer.timedOut && styles.bubbleSilent,
            pressed && canReply && styles.bubblePressed,
          ]}>
          {replyTo ? (
            <Quote answer={replyTo} author={replyToAuthor} onOwnBubble={false} />
          ) : null}
          <ThemedText type="body" style={answer.timedOut ? styles.silentText : undefined}>
            {body}
          </ThemedText>
        </Pressable>
      </View>

      {canReply && onReply ? (
        <ReplyButton onPress={onReply} name={replyLabel} selected={replySelected} />
      ) : null}
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
  bubblePressed: {
    opacity: 0.75,
  },
  /** Matches the avatar gutter on the other side, so the row stays balanced. */
  replyButton: {
    alignSelf: 'center',
    width: 30,
    height: 30,
    borderRadius: Radius.pill,
    backgroundColor: Colors.backgroundElement,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyButtonActive: {
    backgroundColor: Colors.accentMuted,
  },
  replyButtonPressed: {
    backgroundColor: Colors.accentMuted,
    transform: [{ scale: 0.92 }],
  },
  replyGlyph: {
    fontSize: 15,
    lineHeight: 18,
    color: Colors.textSecondary,
  },
  replyGlyphActive: {
    color: Colors.accent,
  },
  quote: {
    alignSelf: 'stretch',
    borderLeftWidth: 3,
    borderRadius: Radius.sm,
    backgroundColor: Colors.backgroundInset,
    paddingVertical: 6,
    paddingHorizontal: Spacing.two,
    marginBottom: Spacing.two,
    gap: 2,
  },
  quoteOwn: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  quoteText: {
    color: Colors.textSecondary,
  },
  quoteTextOwn: {
    color: 'rgba(255, 255, 255, 0.85)',
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
