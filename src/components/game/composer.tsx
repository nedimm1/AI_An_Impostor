import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type ComposerProps = {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function Composer({ onSend, disabled, placeholder = 'Say something…' }: ComposerProps) {
  const [text, setText] = useState('');
  const canSend = text.trim().length > 0 && !disabled;

  const send = () => {
    if (!canSend) return;
    onSend(text);
    setText('');
  };

  return (
    <View style={styles.bar}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={disabled ? 'Chat is closed' : placeholder}
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
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
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
