import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { colorForId, Colors, Radius, Spacing } from '@/constants/theme';
import { textOnTint } from '@/game/seats';
import type { Answer, Player } from '@/game/types';

/** The avatar and the gutter it sits in. */
const AVATAR = 40;

/** The reply button beside each bubble. Small, so it costs the bubble little width. */
const REPLY_BUTTON = 28;

/** How far a bubble has to be dragged before letting go replies to it. */
const SWIPE_TO_REPLY = 56;
/** And how far it will follow the finger at most. */
const SWIPE_MAX = 72;

type AnswerBubbleProps = {
  answer: Answer;
  author?: Player;
  /** The answer this one was written at, when it was a reply. */
  replyTo?: Answer;
  replyToAuthor?: Player;
  /** Swiping the bubble right, or long-pressing it, picks it as the thing you are replying to. */
  onReply?: () => void;
  /** True while this is the answer the composer is aimed at. */
  replySelected?: boolean;
};

/**
 * What an empty turn says instead of an answer, or null when there is an answer.
 * Running out of time and losing the connection are different things to have
 * happened to somebody, and the room should be able to tell which.
 */
function silentLabel(answer: Answer): string | null {
  if (!answer.timedOut) return null;
  return answer.lostConnection ? 'lost connection before finishing' : 'ran out of time';
}

/** The quoted answer a reply sits on top of, WhatsApp-style. */
function Quote({ answer, author }: { answer: Answer; author?: Player }) {
  // The seat's own colour, not a hash of its id — the name says "Mr. Green",
  // so the word beside it has to be green. `colorForId` stays for authorless
  // rows, which have no seat to take a colour from.
  //
  // The side border is that colour on every bubble, your own included: it is
  // how you see at a glance whose words are being answered. On your own tint a
  // coloured border used to be swapped for the bubble's ink, which made every
  // quote in your bubbles look the same — so the quote is the same dark block
  // on every bubble, which any seat's colour reads against.
  const color = author ? author.tint || colorForId(author.id) : Colors.textSecondary;

  return (
    <View style={[styles.quote, { borderLeftColor: color }]}>
      <ThemedText type="smallBold" numberOfLines={1} style={[styles.quoteName, { color }]}>
        {author?.isYou ? 'You' : (author?.name ?? 'Someone')}
      </ThemedText>
      <ThemedText type="small" numberOfLines={2} style={styles.quoteText}>
        {silentLabel(answer) ?? answer.text}
      </ThemedText>
    </View>
  );
}

/**
 * The visible way to reply: a small button beside the bubble, level with its
 * bottom edge.
 *
 * It went away once, for swipe-to-reply, and came back because nothing on
 * screen said a swipe was there — people could not tell how to answer
 * somebody. It is smaller than the first one (which was as wide as an avatar
 * and took a fifth of every row) and carries a real reply icon rather than a
 * text arrow, so it reads as a button and not as decoration.
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
      hitSlop={8}
      style={({ pressed }) => [
        styles.replyButton,
        selected && styles.replyButtonSelected,
        pressed && styles.replyButtonPressed,
      ]}>
      <SymbolView
        name={{ ios: 'arrowshape.turn.up.left.fill', android: 'reply', web: 'reply' }}
        size={13}
        tintColor={selected ? Colors.textOnAccent : Colors.textMuted}
      />
    </Pressable>
  );
}

/**
 * Drag a message right and let go to reply to it, the way WhatsApp does — the
 * shortcut beside the reply button, for people who expect it.
 *
 * The drag only claims a clearly sideways movement, so scrolling the chat is
 * never mistaken for it. An arrow fades in behind the bubble as it moves and
 * is fully lit at the point where letting go will count.
 */
function SwipeToReply({ onReply, children }: { onReply?: () => void; children: ReactNode }) {
  const x = useSharedValue(0);

  const pan = Gesture.Pan()
    .enabled(!!onReply)
    .activeOffsetX(12)
    .failOffsetX(-12)
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      // Follows the finger, then resists past the maximum instead of stopping dead.
      const t = Math.max(0, e.translationX);
      x.value = t <= SWIPE_MAX ? t : SWIPE_MAX + (t - SWIPE_MAX) * 0.15;
    })
    .onEnd(() => {
      if (x.value >= SWIPE_TO_REPLY && onReply) scheduleOnRN(onReply);
    })
    .onFinalize(() => {
      x.value = withSpring(0, { damping: 18, stiffness: 220 });
    });

  const moving = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const arrow = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, SWIPE_TO_REPLY], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(x.value, [0, SWIPE_TO_REPLY], [0.6, 1], 'clamp') }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <View>
        <Animated.View style={[styles.swipeArrow, arrow]} pointerEvents="none">
          <ThemedText style={styles.replyGlyph}>
            {/* Variation selector keeps Android off the emoji glyph. */}
            {'\u21A9\uFE0E'}
          </ThemedText>
        </Animated.View>
        <Animated.View style={moving}>{children}</Animated.View>
      </View>
    </GestureDetector>
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
  const body = silentLabel(answer) ?? answer.text;

  // A turn nobody wrote in is not something you can answer back to.
  const canReply = !!onReply && !answer.timedOut;

  const replyLabel = author?.isYou ? 'your own answer' : (author?.name ?? 'this answer');

  if (isYou) {
    const tint = author?.tint || Colors.accent;
    const ink = author?.tint ? textOnTint(author.tint) : Colors.textOnAccent;

    return (
      <SwipeToReply onReply={canReply ? onReply : undefined}>
        <View style={[styles.row, styles.rowOwn]}>
          <View style={[styles.bubbleColumn, styles.bubbleColumnOwn]}>
            <ThemedText type="smallBold" style={[styles.name, { color: tint }]}>
              {author ? `${author.name} (you)` : 'You'}
            </ThemedText>
            <View style={styles.bubbleLine}>
              {canReply && onReply ? (
                <ReplyButton onPress={onReply} name={replyLabel} selected={replySelected} />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityHint={canReply ? 'Swipe right or long press to reply' : undefined}
                accessibilityActions={
                  canReply ? [{ name: 'longpress', label: `Reply to ${replyLabel}` }] : undefined
                }
                onAccessibilityAction={onReply}
                disabled={!canReply}
                onLongPress={onReply}
                delayLongPress={250}
                style={({ pressed }) => [
                  styles.bubble,
                  styles.bubbleOwn,
                  { backgroundColor: tint },
                  answer.timedOut && styles.bubbleSilent,
                  replySelected && styles.bubbleReplying,
                  pressed && canReply && styles.bubblePressed,
                ]}>
                {replyTo ? <Quote answer={replyTo} author={replyToAuthor} /> : null}
                <ThemedText
                  type="body"
                  style={answer.timedOut ? styles.silentText : [styles.ownText, { color: ink }]}>
                  {body}
                </ThemedText>
              </Pressable>
            </View>
          </View>
        </View>
      </SwipeToReply>
    );
  }

  return (
    <SwipeToReply onReply={canReply ? onReply : undefined}>
      <View style={[styles.row, styles.rowOthers]}>
        <View style={styles.gutter}>
          {author ? (
            <Avatar
              id={author.id}
              name={author.name}
              tint={author.tint}
              size={AVATAR}
              star={author.star}
            />
          ) : null}
        </View>

        <View style={styles.bubbleColumn}>
          {author ? (
            <ThemedText
              type="smallBold"
              style={[styles.name, { color: author.tint || colorForId(author.id) }]}>
              {author.name}
            </ThemedText>
          ) : null}
          <View style={styles.bubbleLine}>
            <Pressable
              accessibilityRole="button"
              accessibilityHint={canReply ? 'Swipe right or long press to reply' : undefined}
              accessibilityActions={
                canReply ? [{ name: 'longpress', label: `Reply to ${replyLabel}` }] : undefined
              }
              onAccessibilityAction={onReply}
              disabled={!canReply}
              onLongPress={onReply}
              delayLongPress={250}
              style={({ pressed }) => [
                styles.bubble,
                styles.bubbleOthers,
                answer.timedOut && styles.bubbleSilent,
                replySelected && styles.bubbleReplying,
                pressed && canReply && styles.bubblePressed,
              ]}>
              {replyTo ? <Quote answer={replyTo} author={replyToAuthor} /> : null}
              <ThemedText type="body" style={answer.timedOut ? styles.silentText : undefined}>
                {body}
              </ThemedText>
            </Pressable>
            {canReply && onReply ? (
              <ReplyButton onPress={onReply} name={replyLabel} selected={replySelected} />
            ) : null}
          </View>
        </View>
      </View>
    </SwipeToReply>
  );
}

/**
 * A chat, not a form. Bubbles are sized to what was said — a one-word answer
 * gets a small bubble, not a tall pill — with a tighter corner on the side the
 * name is on, the way a messaging app marks who a bubble belongs to. Names are
 * in normal case: in capitals they were louder than the answers under them.
 */
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: Spacing.three,
    alignItems: 'flex-start',
  },
  rowOwn: {
    justifyContent: 'flex-end',
    paddingLeft: Spacing.five,
  },
  /** Room on the right so a long answer still reads as somebody else's, not yours. */
  rowOthers: {
    paddingRight: Spacing.four,
  },
  gutter: {
    width: AVATAR,
  },
  bubbleColumn: {
    flexShrink: 1,
    gap: 3,
    alignItems: 'flex-start',
  },
  bubbleColumnOwn: {
    alignItems: 'flex-end',
  },
  /** The bubble and its reply button, centred on each other. */
  bubbleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  name: {
    fontSize: 13,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  replyButton: {
    width: REPLY_BUTTON,
    height: REPLY_BUTTON,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.backgroundElement,
  },
  replyButtonSelected: {
    backgroundColor: Colors.accent,
  },
  replyButtonPressed: {
    transform: [{ scale: 0.9 }],
    backgroundColor: Colors.backgroundSelected,
  },
  bubble: {
    flexShrink: 1,
    minWidth: 40,
    borderRadius: 20,
    // Transparent until it matters: a dashed edge on a silent turn, the accent
    // on the answer being replied to. Always there, so neither changes the size.
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  bubbleOthers: {
    backgroundColor: Colors.backgroundElement,
    borderTopLeftRadius: 6,
  },
  bubbleOwn: {
    backgroundColor: Colors.accent,
    borderTopRightRadius: 6,
  },
  bubblePressed: {
    opacity: 0.75,
  },
  /** Sits behind the left edge of the row, uncovered as the bubble is dragged. */
  swipeArrow: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    top: Spacing.three,
    width: AVATAR,
    alignItems: 'center',
    justifyContent: 'center',
  },
  replyGlyph: {
    fontSize: 18,
    lineHeight: 22,
    color: Colors.accentText,
  },
  /** The answer the composer is currently aimed at. */
  bubbleReplying: {
    borderColor: Colors.accentText,
  },
  quote: {
    alignSelf: 'stretch',
    borderLeftWidth: 3,
    borderRadius: 10,
    backgroundColor: Colors.backgroundInset,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginTop: 4,
    marginBottom: 6,
    marginHorizontal: -6,
  },
  quoteName: {
    fontSize: 12,
    lineHeight: 16,
  },
  quoteText: {
    color: Colors.textSecondary,
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
