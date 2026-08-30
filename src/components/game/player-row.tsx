import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Pill } from '@/components/ui/pill';
import { Spacing } from '@/constants/theme';
import type { Player } from '@/game/types';

export function PlayerRow({ player, trailing }: { player: Player; trailing?: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Avatar id={player.id} name={player.name} dimmed={!player.connected} />

      <View style={styles.names}>
        <View style={styles.nameLine}>
          <ThemedText type="bodyBold" numberOfLines={1}>
            {player.name}
          </ThemedText>
          {player.isYou ? <Pill label="You" tone="accent" /> : null}
          {player.isHost ? <Pill label="Host" /> : null}
        </View>
        <ThemedText type="small" themeColor={player.isReady ? 'success' : 'textMuted'}>
          {player.isReady ? 'Ready' : 'Not ready'}
        </ThemedText>
      </View>

      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  names: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
});
