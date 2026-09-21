import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  LinearTransition,
  useReducedMotion,
  ZoomIn,
  ZoomOut,
} from 'react-native-reanimated';

import { FigureDisc, PORTRAIT, ROBOT_GROUND } from '@/components/game/figure-disc';
import { ThemedText } from '@/components/themed-text';
import { Avatar } from '@/components/ui/avatar';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { SEAT_COLOURS } from '@/game/seats';
import { ROOM_SIZES, type RoomSize } from '@/game/types';

/**
 * How big a room to queue for: three, four or five seats, the impostor's
 * included.
 *
 * Drawn as the room itself — a row of seats with Mister Robot sitting among
 * them — over a plain 3 / 4 / 5 switch. Three boxes with a number and a word
 * did not say three of what, and a row of faces with one robot in it says
 * "this many of you, and one of them is it" without a label.
 *
 * Each size also has a name for what it plays like, because the sizes are
 * different games rather than more or less of the same one. Three is a duel —
 * you know you are human, so the model is one of exactly two other seats. Five
 * is the hunt the rules were tuned for.
 */
const MODES: Record<RoomSize, string> = {
  3: 'Duel',
  4: 'Quick',
  5: 'Classic',
};

/**
 * Decorative seats for the lineup. Fixed rather than drawn per match, and red
 * left out, so no person in it is the colour of the robot's ring.
 */
const LINEUP_TINTS = ['Blue', 'Yellow', 'Green', 'Pink'].map(
  (name) => SEAT_COLOURS.find((c) => c.name === name)!.tint
);

/**
 * How big a face is. As big as `MAX_FACE`, or smaller when five of them would
 * not fit across the card — on a small phone they shrink rather than overflow.
 */
const MAX_FACE = 60;
/**
 * The smallest a face is allowed to get. Only a backstop: it catches a layout
 * pass that reports a width too small to divide — Android fires one with a
 * width of zero often enough that an unguarded `(0 - gaps) / seats` was the
 * one way this row could come out negative, which Yoga reads as "no size" and
 * draws as nothing at all.
 */
const MIN_FACE = 24;
const FACE_GAP = Spacing.two;
const MOST_SEATS = Math.max(...ROOM_SIZES);

/**
 * How far the segment labels are allowed to follow the system font size.
 *
 * The three of them share one row and each gets a third of it, so a long label
 * has nowhere to go: past about 1.3x "5 players" wraps, and a wrapped segment
 * is twice as tall with `Radius.pill` still on it, which draws the selected
 * one as a lopsided oval rather than a pill. The row is a compact control and
 * the spoken label below carries the same words at full size, so holding the
 * drawn text here costs a reader nothing.
 */
const SEGMENT_MAX_SCALE = 1.3;

type Seat = { key: string; tint: string; robot: boolean };

/** The people in order, with the robot in the middle of them — where the logo puts it. */
function lineup(size: RoomSize): Seat[] {
  const people: Seat[] = LINEUP_TINTS.slice(0, size - 1).map((tint) => ({
    key: tint,
    tint,
    robot: false,
  }));
  const middle = Math.floor(size / 2);
  return [
    ...people.slice(0, middle),
    // Black, like the logo — and the ground his portrait carries with it.
    { key: 'robot', tint: ROBOT_GROUND, robot: true },
    ...people.slice(middle),
  ];
}

export function RoomSizePicker({
  value,
  onChange,
}: {
  value: RoomSize;
  onChange: (size: RoomSize) => void;
}) {
  const mode = MODES[value];
  // Every room has exactly one impostor; everyone else, you included, is a person.
  const humans = value - 1;
  const [face, setFace] = useState(MAX_FACE);
  const reduceMotion = useReducedMotion();

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="label" themeColor="textSecondary">
          Room
        </ThemedText>
        <ThemedText type="label" style={styles.modeName}>
          {mode}
        </ThemedText>
      </View>

      <View
        style={[styles.lineup, { height: face }]}
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        onLayout={(e) => {
          const { width } = e.nativeEvent.layout;
          // A zero-width pass measures nothing; taking it would size the row
          // off a number that is not the row's width yet.
          if (width <= 0) return;
          const fits = (width - FACE_GAP * (MOST_SEATS - 1)) / MOST_SEATS;
          setFace(Math.max(MIN_FACE, Math.min(MAX_FACE, Math.floor(fits))));
        }}>
        {lineup(value).map((seat) => (
          <Animated.View
            key={seat.key}
            /*
              The seats zoom in, zoom out and slide to their new places — but
              only where the device intends to finish the job.

              With "Animator duration scale" off (Developer Options, and set
              that way on plenty of real phones) these never ran to completion
              and left a seat at the opacity, scale and position it started
              from: a seat missing from the row, a disc with no portrait in it,
              the whole lineup piled up at one end. Reanimated reads that same
              switch as reduced motion, so asking it here is asking exactly the
              question that was being got wrong — and the answer, no animation
              at all, is also what someone who turned the switch on was asking
              for. Off, the row is plain and therefore correct; on, it moves.
            */
            entering={reduceMotion ? undefined : ZoomIn.duration(220)}
            exiting={reduceMotion ? undefined : ZoomOut.duration(160)}
            layout={reduceMotion ? undefined : LinearTransition.duration(220)}>
            {seat.robot ? (
              <FigureDisc art={PORTRAIT.robot} color={seat.tint} size={face} ring={Colors.accent} />
            ) : (
              <Avatar id={seat.key} name="" tint={seat.tint} size={face} />
            )}
          </Animated.View>
        ))}
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.blurb}>
        {humans} humans · 1 robot
      </ThemedText>

      <View style={styles.switch} accessibilityRole="radiogroup" accessibilityLabel="Room size">
        {ROOM_SIZES.map((size) => {
          const selected = size === value;
          return (
            <Pressable
              key={size}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`${size} players, ${MODES[size]}`}
              onPress={() => onChange(size)}
              style={({ pressed }) => [
                styles.segment,
                selected && styles.segmentSelected,
                pressed && !selected && styles.segmentPressed,
              ]}>
              <ThemedText
                type="smallBold"
                numberOfLines={1}
                maxFontSizeMultiplier={SEGMENT_MAX_SCALE}
                style={selected ? styles.segmentTextSelected : styles.segmentText}>
                {size} players
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modeName: {
    color: Colors.accentText,
  },
  lineup: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: FACE_GAP,
  },
  blurb: {
    textAlign: 'center',
    marginTop: -Spacing.one,
  },
  switch: {
    flexDirection: 'row',
    padding: Spacing.one,
    gap: Spacing.one,
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderRadius: Radius.pill,
    // Every segment carries the border, so selecting one does not change its height.
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentSelected: {
    backgroundColor: Colors.backgroundSelected,
    borderColor: Colors.accent,
  },
  segmentPressed: {
    backgroundColor: Colors.backgroundSelected,
  },
  segmentText: {
    color: Colors.textMuted,
    textAlign: 'center',
  },
  segmentTextSelected: {
    color: Colors.text,
    textAlign: 'center',
  },
});
