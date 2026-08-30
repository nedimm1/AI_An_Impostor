import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { makeRoomCode } from '@/game/mock';
import { useRoomStore } from '@/game/store';

const ROUND_OPTIONS = [3, 5, 7];
const SIZE_OPTIONS = [6, 8, 10];

export default function CreateRoomScreen() {
  const router = useRouter();
  const { displayName, createRoom, setSettings } = useRoomStore();

  const [name, setName] = useState(displayName);
  const [rounds, setRounds] = useState(3);
  const [maxPlayers, setMaxPlayers] = useState(8);

  const canCreate = name.trim().length >= 2;

  const handleCreate = () => {
    if (!canCreate) return;
    const code = makeRoomCode();
    createRoom(code, name.trim());
    setSettings({ rounds, maxPlayers });
    router.replace({ pathname: '/room/[code]', params: { code } });
  };

  return (
    <Screen edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScreenHeader title="New room" subtitle="You'll be the host" />

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <TextField
            label="Your name"
            value={name}
            onChangeText={setName}
            placeholder="What should everyone call you?"
            autoFocus
            maxLength={16}
            returnKeyType="done"
          />

          <Card title="Rounds">
            <OptionRow
              options={ROUND_OPTIONS}
              value={rounds}
              onChange={setRounds}
              suffix="rounds"
            />
          </Card>

          <Card title="Room size">
            <OptionRow
              options={SIZE_OPTIONS}
              value={maxPlayers}
              onChange={setMaxPlayers}
              suffix="players"
            />
          </Card>

          <ThemedText type="small" themeColor="textMuted" style={styles.note}>
            Game modes and impostor difficulty land here once they exist.
          </ThemedText>
        </ScrollView>

        <View style={styles.footer}>
          <Button label="Create room" onPress={handleCreate} disabled={!canCreate} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function OptionRow({
  options,
  value,
  onChange,
  suffix,
}: {
  options: number[];
  value: number;
  onChange: (next: number) => void;
  suffix: string;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map((option) => (
        <Button
          key={option}
          label={`${option} ${suffix}`}
          size="md"
          variant={option === value ? 'primary' : 'secondary'}
          onPress={() => onChange(option)}
          style={styles.option}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: Spacing.four,
    paddingBottom: Spacing.four,
  },
  optionRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  option: {
    flex: 1,
    borderRadius: Radius.md,
  },
  note: {
    textAlign: 'center',
    color: Colors.textMuted,
  },
  footer: {
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
});
