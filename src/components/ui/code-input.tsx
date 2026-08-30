import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
};

/**
 * Room-code entry. A single invisible TextInput drives a row of character
 * boxes, which keeps native autofill/paste working without per-box focus logic.
 */
export function CodeInput({ value, onChange, length = 4, autoFocus }: CodeInputProps) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const boxes = Array.from({ length }, (_, i) => value[i] ?? '');
  const cursor = Math.min(value.length, length - 1);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Room code"
      onPress={() => inputRef.current?.focus()}
      style={styles.row}>
      {boxes.map((char, i) => {
        const active = focused && i === cursor && value.length < length;
        return (
          <View key={i} style={[styles.box, (active || char) && styles.boxFilled]}>
            <ThemedText type="title" themeColor={char ? 'text' : 'textMuted'}>
              {char || '·'}
            </ThemedText>
          </View>
        );
      })}

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(text) =>
          onChange(
            text
              .toUpperCase()
              .replace(/[^A-Z]/g, '')
              .slice(0, length)
          )
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={length}
        keyboardAppearance="dark"
        style={styles.hiddenInput}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
  },
  box: {
    flex: 1,
    maxWidth: 78,
    aspectRatio: 0.86,
    borderRadius: Radius.lg,
    backgroundColor: Colors.backgroundInset,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentMuted,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
  },
});
