import { Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FigureDisc, PORTRAIT } from '@/components/game/figure-disc';
import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { humansAlive, playerById, voteTally, type Player, type Room } from '@/game/types';

/**
 * The result of a vote, in two parts: what happened (`VerdictHero`) and how the
 * room got there (`VoteBreakdown`). Kept apart from the results screen, which
 * owns the clock and the buttons, so every outcome can be drawn from a room on
 * its own.
 */

type Tone = 'danger' | 'success' | 'neutral' | 'warning';

const TONES: Record<Tone, { bg: string; border: string; label: string }> = {
  danger: { bg: Colors.dangerMuted, border: Colors.danger + '55', label: Colors.danger },
  success: { bg: Colors.successMuted, border: Colors.success + '55', label: Colors.success },
  warning: { bg: Colors.warningMuted, border: Colors.warning + '55', label: Colors.warning },
  neutral: { bg: Colors.backgroundElement, border: Colors.border, label: Colors.textSecondary },
};

/**
 * A seat's name in its own colour — how the room already tells people apart.
 * A bare `Text` on purpose: nested inside a headline it inherits that line's
 * size and weight, where a `ThemedText` would impose its own and break the line.
 */
function Name({ player, you }: { player: Player | undefined; you?: boolean }) {
  if (!player) return <Text>somebody</Text>;
  return (
    <Text style={{ color: player.tint || Colors.text }}>
      {you && player.isYou ? 'You' : player.name}
    </Text>
  );
}

export function VerdictHero({ room }: { room: Room }) {
  const eliminated = playerById(room, room.eliminatedId);
  const impostor = playerById(room, room.impostorId);
  const youWereVotedOut = room.eliminatedId === room.youId;
  const nobodyVoted = Object.keys(room.votes).length === 0;
  const tiedUp = (room.pendingTiebreaker ?? [])
    .map((id) => playerById(room, id))
    .filter((p): p is Player => p != null);
  // The seat the picture is about, worn as the whole disc. The robot is always
  // the impostor, so it wears the impostor's colour even when the vote put a
  // person out; otherwise the circle is whoever this vote put out.
  const portraitColor =
    (room.outcome ? impostor : eliminated)?.tint || Colors.backgroundSelected;

  let tone: Tone;
  let label: string;
  let art: ReactNode = null;
  let headline: ReactNode;
  let detail: string;

  if (room.outcome === 'humans') {
    tone = 'success';
    label = 'Humans win';
    art = <FigureDisc art={PORTRAIT.robotOut} color={portraitColor} size={160} ring={Colors.background} />;
    headline = (
      <ThemedText type="title" style={styles.centered}>
        <Name player={impostor} /> was the impostor
      </ThemedText>
    );
    detail = 'The room voted it out.';
  } else if (room.outcome === 'impostor') {
    tone = 'danger';
    label = 'Impostor wins';
    art = <FigureDisc art={PORTRAIT.robot} color={portraitColor} size={160} ring={Colors.background} />;
    const personOut = eliminated && eliminated.id !== room.impostorId ? eliminated : null;
    headline = (
      <View style={styles.headlineStack}>
        {personOut ? (
          <ThemedText type="subtitle" style={styles.centered}>
            <Name player={personOut} you /> {youWereVotedOut ? 'were' : 'was'} not the impostor,
          </ThemedText>
        ) : null}
        <ThemedText type="title" style={styles.centered}>
          <Name player={impostor} /> was the impostor
        </ThemedText>
      </View>
    );
    detail =
      humansAlive(room) <= 1
        ? `Only ${humansAlive(room)} human left, so it can't be outvoted.`
        : `It made it through all ${room.settings.maxRounds} rounds without being caught.`;
  } else if (tiedUp.length >= 2) {
    tone = 'warning';
    label = 'Tie';
    art = (
      <View style={styles.tiedPair}>
        {tiedUp.map((p, i) => (
          <Fragment key={p.id}>
            {i > 0 ? (
              <ThemedText type="subtitle" themeColor="textMuted" style={styles.versus}>
                vs
              </ThemedText>
            ) : null}
            <View style={styles.tiedSeat}>
              <Avatar id={p.id} name={p.name} tint={p.tint} size={72} ringColor={Colors.warning} />
              <ThemedText type="smallBold" numberOfLines={1} style={{ color: p.tint }}>
                {p.isYou ? 'You' : p.name}
              </ThemedText>
            </View>
          </Fragment>
        ))}
      </View>
    );
    headline = (
      <ThemedText type="title" style={styles.centered}>
        The room is split
      </ThemedText>
    );
    detail = tiedUp.some((p) => p.isYou)
      ? 'Nobody is out. You and the other one go again — say why it is not you, then the room votes between you.'
      : 'Nobody is out. These two go again, then the room votes between them.';
  } else if (eliminated) {
    tone = 'neutral';
    label = 'Not the impostor';
    art = <FigureDisc art={PORTRAIT.misterOut} color={portraitColor} size={160} ring={Colors.background} />;
    headline = (
      <ThemedText type="title" style={styles.centered}>
        {youWereVotedOut ? (
          'You were voted out'
        ) : (
          <>
            <Name player={eliminated} /> is out
          </>
        )}
      </ThemedText>
    );
    detail = youWereVotedOut
      ? 'You were not the impostor. It is still in the room.'
      : `${eliminated.name} was not the impostor. It is still in the room.`;
  } else {
    tone = 'neutral';
    label = 'Nobody out';
    headline = (
      <ThemedText type="title" style={styles.centered}>
        {nobodyVoted ? 'Nobody voted' : 'Nobody was voted out'}
      </ThemedText>
    );
    detail = nobodyVoted
      ? 'The ballot closed empty. The round is spent and everyone stays in.'
      : room.tiebreaker
        ? 'The tiebreaker was tied too. The round is spent and everyone stays in.'
        : 'More than two tied, so there is nobody to go between. The round is spent and everyone stays in.';
  }

  const t = TONES[tone];

  return (
    <View style={[styles.hero, { backgroundColor: t.bg, borderColor: t.border }]}>
      <View style={[styles.label, { borderColor: t.border }]}>
        <ThemedText type="label" style={{ color: t.label }}>
          {label}
        </ThemedText>
      </View>
      {art}
      {headline}
      <ThemedText type="small" themeColor="textSecondary" style={[styles.centered, styles.detail]}>
        {detail}
      </ThemedText>
    </View>
  );
}

/**
 * Where every vote went, and who is no longer in the running.
 *
 * Two lists, because they answer different questions. "The vote" is this
 * ballot: only the people who could be voted for, most-voted first, each with
 * the faces of who voted for them. "Voted out" is the whole match so far —
 * everybody the room has removed, this round's first — so people knocked out
 * in earlier rounds stop sitting at the bottom of every ballot with a zero.
 * People who left or lost their connection get their own line under that, since
 * nobody voted them anywhere.
 */
export function VoteBreakdown({ room }: { room: Room }) {
  const tally = voteTally(room);
  const cast = Object.keys(room.votes).length;
  const most = Math.max(1, ...Object.values(tally));
  const decided = room.outcome !== null;

  const votesFor = (id: string) => tally[id] ?? 0;

  // On this ballot: still in when it opened. This round's voted-out player was,
  // and anyone who walked out mid-vote still keeps the votes they got.
  const onBallot = room.players
    .filter(
      (p) =>
        (p.connected && (!p.eliminated || p.id === room.eliminatedId)) || votesFor(p.id) > 0
    )
    .sort((a, b) => votesFor(b.id) - votesFor(a.id) || a.name.localeCompare(b.name));

  const votedOut = room.players
    .filter((p) => p.eliminated)
    .sort((a, b) => Number(b.id === room.eliminatedId) - Number(a.id === room.eliminatedId));

  const departed = room.players.filter((p) => !p.connected && !p.eliminated);

  return (
    <View style={styles.breakdown}>
      <View style={styles.sectionHeader}>
        <ThemedText type="label" themeColor="textSecondary">
          The vote
        </ThemedText>
        <ThemedText type="small" themeColor="textMuted">
          {cast === 0 ? 'Nobody voted' : `${cast} ${cast === 1 ? 'vote' : 'votes'}`}
        </ThemedText>
      </View>

      <View style={styles.list}>
        {onBallot.map((player, i) => {
          const count = votesFor(player.id);
          const share = count / most;
          const outThisRound = player.id === room.eliminatedId;
          const isImpostor = decided && player.id === room.impostorId;
          const voters = Object.entries(room.votes)
            .filter(([, target]) => target === player.id)
            .map(([voter]) => playerById(room, voter))
            .filter((p): p is Player => p != null);
          const tint = player.tint || Colors.accent;

          return (
            <View key={player.id} style={[styles.row, i > 0 && styles.rowDivider]}>
              {count > 0 ? (
                // A full-size layer first, and the wash as a percentage of
                // that: a percentage width on an absolute child is measured
                // inside the row's padding, so a lone 100% stopped short of the
                // edge and looked cut off.
                <View pointerEvents="none" style={styles.washLayer}>
                  <View
                    style={[
                      styles.wash,
                      share >= 1 && styles.washFull,
                      {
                        width: `${Math.max(share * 100, 10)}%`,
                        backgroundColor: tint + (outThisRound ? '44' : '24'),
                      },
                    ]}
                  />
                </View>
              ) : null}

              {isImpostor ? (
                <RobotFace room={room} tint={tint} size={40} />
              ) : (
                <Avatar id={player.id} name={player.name} tint={tint} size={40} />
              )}

              <View style={styles.rowBody}>
                <View style={styles.nameLine}>
                  <ThemedText type="bodyBold" numberOfLines={1} style={styles.rowName}>
                    {player.isYou ? 'You' : player.name}
                  </ThemedText>
                  {!player.connected ? (
                    <ThemedText type="small" themeColor="textMuted">
                      {player.departedBecause === 'disconnected' ? 'disconnected' : 'left'}
                    </ThemedText>
                  ) : null}
                </View>

                {voters.length > 0 ? (
                  <View
                    style={styles.voters}
                    accessibilityLabel={`Voted for by ${voters.map((v) => v.name).join(', ')}`}>
                    {voters.map((v, k) => (
                      <Avatar
                        key={v.id}
                        id={v.id}
                        name={v.name}
                        tint={v.tint}
                        size={22}
                        // A ring in the card's colour, so overlapping faces stay
                        // separate instead of merging into one blob.
                        ringColor={Colors.backgroundElement}
                        style={k > 0 ? styles.voterOverlap : undefined}
                      />
                    ))}
                  </View>
                ) : (
                  <ThemedText type="small" themeColor="textMuted">
                    No votes
                  </ThemedText>
                )}
              </View>

              <ThemedText
                type="subtitle"
                style={[styles.count, { color: count > 0 ? Colors.text : Colors.textMuted }]}>
                {count}
              </ThemedText>
            </View>
          );
        })}
      </View>

      {votedOut.length > 0 ? (
        <>
          <View style={[styles.sectionHeader, styles.sectionGap]}>
            <ThemedText type="label" themeColor="textSecondary">
              Voted out
            </ThemedText>
            <ThemedText type="small" themeColor="textMuted">
              {votedOut.length}
            </ThemedText>
          </View>

          <View style={styles.outGrid}>
            {votedOut.map((player) => {
              const isImpostor = decided && player.id === room.impostorId;
              const thisRound = player.id === room.eliminatedId;
              return (
                <View
                  key={player.id}
                  style={[styles.outCard, thisRound && { borderColor: player.tint + '99' }]}>
                  {isImpostor ? (
                    <RobotFace room={room} tint={player.tint} size={52} />
                  ) : (
                    <FigureDisc art={PORTRAIT.misterOut} color={player.tint} size={52} />
                  )}
                  <ThemedText type="smallBold" numberOfLines={1} style={styles.outName}>
                    {player.isYou ? 'You' : player.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textMuted" style={styles.outNote}>
                    {thisRound ? 'This round' : 'Earlier'}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        </>
      ) : null}

      {departed.length > 0 ? (
        <>
          <View style={[styles.sectionHeader, styles.sectionGap]}>
            <ThemedText type="label" themeColor="textSecondary">
              Left the game
            </ThemedText>
          </View>
          <View style={styles.list}>
            {departed.map((player, i) => (
              <View key={player.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                <Avatar id={player.id} name={player.name} tint={player.tint} size={32} dimmed />
                <ThemedText type="body" themeColor="textSecondary" style={styles.rowName}>
                  {player.isYou ? 'You' : player.name}
                </ThemedText>
                <ThemedText type="small" themeColor="textMuted">
                  {player.departedBecause === 'disconnected' ? 'Disconnected' : 'Left'}
                </ThemedText>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** The impostor's face once the match is decided: the robot, caught or grinning. */
function RobotFace({ room, tint, size }: { room: Room; tint: string; size: number }) {
  return (
    <FigureDisc
      art={room.outcome === 'humans' ? PORTRAIT.robotOut : PORTRAIT.robot}
      color={tint}
      size={size}
    />
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.five,
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.xl,
    borderWidth: 1,
  },
  label: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  headlineStack: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  centered: {
    textAlign: 'center',
  },
  detail: {
    maxWidth: 300,
  },
  tiedPair: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
  },
  tiedSeat: {
    alignItems: 'center',
    gap: Spacing.two,
    maxWidth: 110,
  },
  versus: {
    // Level with the faces rather than the names below them.
    marginBottom: Spacing.four,
  },
  breakdown: {
    gap: Spacing.two,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.one,
  },
  /** One card, rows divided by hairlines — a list, not a stack of boxes. */
  list: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  washLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  wash: {
    height: '100%',
    // A rounded end reads as a bar; a square one reads as a clipped box.
    borderTopRightRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
  },
  washFull: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
  },
  sectionGap: {
    marginTop: Spacing.three,
  },
  /** Voted-out players as small cards, a few to a row. */
  outGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  outCard: {
    width: '31%',
    minWidth: 96,
    flexGrow: 1,
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
  },
  outName: {
    maxWidth: '100%',
    marginTop: Spacing.one,
  },
  outNote: {
    fontSize: 11,
    lineHeight: 14,
  },
  rowBody: {
    flex: 1,
    gap: 6,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  rowName: {
    flexShrink: 1,
  },
  voters: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  voterOverlap: {
    marginLeft: -6,
  },
  count: {
    minWidth: 24,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
