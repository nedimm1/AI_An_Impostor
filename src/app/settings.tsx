import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Divider } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { TextField } from '@/components/ui/text-field';
import { Colors, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';

export default function SettingsScreen() {
  const { displayName, setName } = useRoomStore();

  // The name is persisted; these three are not wired to anything yet.
  const [sound, setSound] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  return (
    <Screen>
      <ScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <TextField
          label="Display name"
          value={displayName}
          onChangeText={setName}
          placeholder="Not set"
          maxLength={16}
          hint="Shown to everyone in the room. Saved on this device."
        />

        <Card title="Preferences" padded={false}>
          <ToggleRow label="Sound effects" value={sound} onChange={setSound} />
          <Divider />
          <ToggleRow label="Haptics" value={haptics} onChange={setHaptics} />
          <Divider />
          <ToggleRow label="Reduce motion" value={reduceMotion} onChange={setReduceMotion} />
        </Card>

        <Card title="About">
          <View style={styles.aboutRow}>
            <ThemedText type="small" themeColor="textSecondary">
              Version
            </ThemedText>
            <ThemedText type="mono" themeColor="textSecondary">
              1.0.0
            </ThemedText>
          </View>
        </Card>

        <ThemedText type="small" themeColor="textMuted" style={styles.note}>
          Sound, haptics and reduce motion are not saved or wired up yet.
        </ThemedText>
      </ScrollView>
    </Screen>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <ThemedText type="body">{label}</ThemedText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: Colors.backgroundSelected, true: Colors.accent }}
        thumbColor={Colors.text}
        ios_backgroundColor={Colors.backgroundSelected}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    paddingBottom: Spacing.four,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    minHeight: 52,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  note: {
    textAlign: 'center',
  },
});
