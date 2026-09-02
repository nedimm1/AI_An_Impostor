import { useImperativeHandle, useState, type Ref } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

export type ComposerHandle = {
  /**
   * Hands over what is typed but unsent, and empties the box. The round screen
   * calls this when the clock hits zero so a half-written answer still lands.
   */
  takeDraft: () => string;
};

/** The answer being replied to, as the composer needs to show it. */
export type ReplyPreview = {
  name: string;
  text: string;
  color: string;
};

type ComposerProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** Shown above the input while an answer is picked to reply to. */
  replyTo?: ReplyPreview | null;
  onCancelReply?: () => void;
  ref?: Ref<ComposerHandle>;
};

export function Composer({
  onSend,
  disabled,
  placeholder = 'Type your answer…',
  replyTo,
  onCancelReply,
  ref,
}: ComposerProps) {
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !disabled;

  useImperativeHandle(
    ref,
    () => ({
      takeDraft: () => {
        setText('');
        return text;
      },
    }),
    [text]
  );

  const send = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={styles.wrapper}>
      {replyTo ? (
        <View style={[styles.replyBar, { borderLeftColor: replyTo.color }]}>
          <View style={styles.replyBody}>
            <ThemedText type="label" numberOfLines={1} style={{ color: replyTo.color }}>
              Replying to {replyTo.name}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
              {replyTo.text}
            </ThemedText>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel reply"
            onPress={onCancelReply}
            hitSlop={12}
            style={({ pressed }) => pressed && styles.cancelPressed}>
            <ThemedText type="body" themeColor="textSecondary">
              ✕
            </ThemedText>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.bar}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
          selectionColor={Colors.accent}
          keyboardAppearance="dark"
          editable={!disabled}
          multiline
          maxLength={280}
          onSubmitEditing={send}
          blurOnSubmit={false}
          returnKeyType="send"
          style={styles.input}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled={!canSend}
          onPress={send}
          style={({ pressed }) => [
            styles.sendButton,
            !canSend && styles.sendDisabled,
            pressed && canSend && styles.sendPressed,
          ]}>
          <ThemedText type="bodyBold" style={styles.sendGlyph}>
            ↑
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    paddingVertical: 6,
    paddingHorizontal: Spacing.two,
    borderLeftWidth: 3,
    borderRadius: Radius.sm,
    backgroundColor: Colors.backgroundElement,
  },
  replyBody: {
    flex: 1,
    gap: 2,
  },
  cancelPressed: {
    opacity: 0.6,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: Colors.backgroundInset,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingTop: 12,
    paddingBottom: 12,
    color: Colors.text,
    fontSize: 16,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendPressed: {
    backgroundColor: Colors.accentPressed,
  },
  sendDisabled: {
    backgroundColor: Colors.backgroundSelected,
  },
  sendGlyph: {
    color: Colors.textOnAccent,
    lineHeight: 20,
  },
});
