import { Redirect, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PlayerRow } from '@/components/game/player-row';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card, Divider } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { useRoomStore } from '@/game/store';

const MIN_PLAYERS = 4;

export default function LobbyScreen() {
  const router = useRouter();
  const { room, leaveRoom, toggleReady, startGame } = useRoomStore();

  if (!room) return <Redirect href="/" />;

  const you = room.players.find((p) => p.isYou);
  const readyCount = room.players.filter((p) => p.isReady).length;
  const canStart = room.players.length >= MIN_PLAYERS;

  const handleLeave = () => {
    leaveRoom();
    router.replace('/');
  };

  const handleStart = () => {
    startGame();
    router.push({ pathname: '/room/[code]/chat', params: { code: room.code } });
  };

  return (
    <Screen>
      <ScreenHeader
        title="Lobby"
        subtitle={`${room.players.length} of ${room.settings.maxPlayers} players`}
        onBack={handleLeave}
        right={<Pill label="Waiting" tone="warning" />}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.codeBlock}>
          <ThemedText type="label">Room code</ThemedText>
          <View style={styles.codeRow}>
            {room.code.split('').map((char, i) => (
              <View key={i} style={styles.codeBox}>
                <ThemedText type="title">{char}</ThemedText>
              </View>
            ))}
          </View>
          <ThemedText type="small" themeColor="textMuted">
            Share this with everyone who&apos;s playing.
          </ThemedText>
        </View>

        <Card title={`Players · ${readyCount} ready`} padded={false}>
          {room.players.map((player, i) => (
            <View key={player.id}>
              {i > 0 ? <Divider /> : null}
              <PlayerRow player={player} />
            </View>
          ))}
        </Card>

        <Card title="Game" padded={false}>
          <SummaryRow label="Rounds" value={`${room.settings.rounds}`} />
          <Divider />
          <SummaryRow label="Chat per round" value={`${room.settings.chatSeconds / 60} min`} />
          <Divider />
          <SummaryRow label="Topic" value={room.settings.topic} />
          <Divider />
          <SummaryRow label="Impostor" value="Coming soon" muted />
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        {you?.isHost ? (
          <>
            <Button label="Start game" onPress={handleStart} disabled={!canStart} />
            {!canStart ? (
              <ThemedText type="small" themeColor="textMuted" style={styles.footerNote}>
                Need at least {MIN_PLAYERS} players to start.
              </ThemedText>
            ) : null}
          </>
        ) : (
          <>
            <Button
              label={you?.isReady ? "I'm not ready" : "I'm ready"}
              variant={you?.isReady ? 'secondary' : 'primary'}
              onPress={toggleReady}
            />
            <ThemedText type="small" themeColor="textMuted" style={styles.footerNote}>
              Waiting for the host to start.
            </ThemedText>
          </>
        )}
      </View>
    </Screen>
  );
}

function SummaryRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <View style={styles.summaryRow}>
      <ThemedText type="body" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="bodyBold" themeColor={muted ? 'textMuted' : 'text'}>
        {value}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    paddingBottom: Spacing.four,
  },
  codeBlock: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
  codeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  codeBox: {
    width: 56,
    height: 64,
    borderRadius: Radius.lg,
    backgroundColor: Colors.backgroundElement,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: 14,
  },
  footer: {
    gap: Spacing.two,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.two,
  },
  footerNote: {
    textAlign: 'center',
  },
});
