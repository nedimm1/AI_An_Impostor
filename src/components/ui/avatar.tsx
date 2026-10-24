import { Image, StyleSheet, View, type ViewStyle } from 'react-native';

import { colorForId, Radius } from '@/constants/theme';

/**
 * One face, worn by everybody, on a disc of that seat's own colour.
 *
 * Every seat is Mr. Something (`game/seats.ts`) and they all look the same on
 * purpose: a room where seats are told apart by their portraits is a room
 * playing spot-the-different-picture instead of reading what people wrote. The
 * colour is the only thing separating one from another.
 *
 * Which is why the colour is the whole disc and not a ring around it. The ring
 * was the first attempt and it did not work: the figure wears a black suit, so
 * on a dark disc the only part of it that survived was the white head, and at
 * the 30px the answer bubble uses, a head and a tie floating in the dark is
 * what it looked like. Filling the disc puts the suit in silhouette against
 * the colour, which reads at every size and carries far more of the colour
 * than a two-pixel outline did.
 *
 * `ringColor` still draws a ring, because that is a different job - marking
 * who is speaking, selected or accused - and it has to sit on top of whatever
 * colour the seat already is.
 */
const MISTER = require('../../../assets/images/mister.png');

/** The plate's own proportions. Kept here so the figure is never stretched. */
const FIGURE_RATIO = 186 / 192;

type AvatarProps = {
  id: string;
  /**
   * Not drawn — every avatar is the same picture. Kept because it is the only
   * thing left that tells a screen reader which seat this is, a job the
   * initials were doing by accident.
   */
  name: string;
  /**
   * The seat's own colour (`Player.tint`). The disc and the name beside it are
   * two renderings of one draw, so passing it keeps them agreeing — "Mr. Green"
   * on a blue disc is worse than no colour at all. Falls back to hashing the id
   * for the decorative lineups that have no seat behind them.
   */
  tint?: string;
  size?: number;
  /** A ring over the disc, e.g. to mark the current speaker. */
  ringColor?: string;
  dimmed?: boolean;
  style?: ViewStyle;
};

export function Avatar({ id, name, tint, size = 40, ringColor, dimmed, style }: AvatarProps) {
  const color = tint || colorForId(id);

  // Deliberately wider than the disc, and pushed down inside it. Both are what
  // make this read as a portrait cropped by a circle rather than a small man
  // standing in the middle of one: the shoulders run off the sides, and the
  // notch between the jacket halves — which would otherwise sit in the frame
  // showing a sliver of the disc through it — falls below the crop.
  const width = size * 1.15;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: Radius.pill,
          backgroundColor: color,
          borderColor: ringColor ?? 'transparent',
          borderWidth: ringColor ? 2 : 0,
          opacity: dimmed ? 0.4 : 1,
        },
        style,
      ]}>
      <Image
        source={MISTER}
        style={{
          width,
          height: width * FIGURE_RATIO,
          // translateY rather than a margin: a margin is part of the box being
          // centred, so half of it is given straight back and the number stops
          // meaning what it says.
          transform: [{ translateY: size * 0.18 }],
        }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    // The figure is wider than the disc at the shoulders; the circle crops it.
    overflow: 'hidden',
  },
});
