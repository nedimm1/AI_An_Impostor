import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';

const CODE_LENGTH = 4;

export default function JoinRoomScreen() {
  const router = useRouter();
  const { displayName, joinRoom } = useRoomStore();

  const [code, setCode] = useState('');
  const [name, setName] = useState(displayName);

  const canJoin = code.length === CODE_LENGTH && name.trim().length >= 2;

  const handleJoin = () => {
    if (!canJoin) return;
    joinRoom(code, name.trim());
    router.replace({ pathname: '/room/[code]', params: { code } });
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title="Join a room" subtitle="Ask the host for the code" />

        <View style={styles.content}>
          <CodeInput value={code} onChange={setCode} length={CODE_LENGTH} autoFocus />

          <TextField
            label="Your name"
            value={name}
            onChangeText={setName}
            placeholder="What should everyone call you?"
            maxLength={16}
            returnKeyType="done"
            onSubmitEditing={handleJoin}
          />

          <ThemedText type="small" themeColor="textMuted" style={styles.note}>
            Any four letters work for now — rooms aren&apos;t on a server yet.
          </ThemedText>
        </View>

        <View style={styles.footer}>
          <Button label="Join room" onPress={handleJoin} disabled={!canJoin} />
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
    gap: Spacing.five,
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
