import { useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radius, Spacing } from '@/constants/theme';

type TextFieldProps = TextInputProps & {
  label?: string;
  hint?: string;
};

export function TextField({ label, hint, style, ...rest }: TextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrapper}>
      {label ? <ThemedText type="label">{label}</ThemedText> : null}
      <TextInput
        placeholderTextColor={Colors.textMuted}
        selectionColor={Colors.accent}
        keyboardAppearance="dark"
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[styles.input, focused && styles.inputFocused, style]}
      />
      {hint ? (
        <ThemedText type="small" themeColor="textMuted">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: Spacing.two,
  },
  input: {
    backgroundColor: Colors.backgroundInset,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.three,
    paddingVertical: 15,
    color: Colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  inputFocused: {
    borderColor: Colors.accent,
  },
});
