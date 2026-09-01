import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';

const MIN_NAME_LENGTH = 2;

/**
 * One-time name step in front of the queue. Only shown until a name is set —
 * after that "Find a game" goes straight to matchmaking.
 */
export default function NameScreen() {
  const router = useRouter();
  const { displayName, setName } = useRoomStore();

  const [value, setValue] = useState(displayName);

  const canContinue = value.trim().length >= MIN_NAME_LENGTH;

  const handleContinue = () => {
    if (!canContinue) return;
    setName(value.trim());
    router.replace('/queue');
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title="Pick a name" subtitle="Strangers will see this" />

        <View style={styles.content}>
          <TextField
            label="Your name"
            value={value}
            onChangeText={setValue}
            placeholder="What should everyone call you?"
            autoFocus
            maxLength={16}
            returnKeyType="go"
            onSubmitEditing={handleContinue}
          />

          <ThemedText type="small" themeColor="textMuted" style={styles.note}>
            You&apos;re matched with people you don&apos;t know. Use whatever you want to be called
            in there — you can change it later in Settings.
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <Button label="Find a game" onPress={handleContinue} disabled={!canContinue} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flex: 1,
    gap: Spacing.four,
    paddingTop: Spacing.four,
  },
  note: {
    textAlign: 'center',
  },
  footer: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
