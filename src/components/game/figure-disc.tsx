import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

import { Radius } from '@/constants/theme';

/**
 * The three faces the game draws outside a living seat: Mister Robot, Mister
 * Robot caught, and a person the room has voted out.
 *
 * Cutouts, like the chat avatar: the figure is black and white, and the seat's
 * colour is the ground it stands on rather than a rim around it. Each is a
 * square plate that fills its disc, so the circle is the only crop.
 *
 * The drawings these are cut from carry no silhouette of their own — the suit
 * in them is the black they were drawn on, with only the lapels marked on top,
 * so lifting the ink off would have left the colour showing through the jacket.
 * Each borrows a suit instead, lined up on its shirt, and they borrow different
 * ones. The person takes `mister.png`, the living seat's own cutout, with the
 * donor's head dropped: a seat that has just been voted out keeps the shoulders
 * it had a second ago in the chat, and its head floats clear of them the same
 * way. The robot takes the winged shoulders of the outlined verdict cutouts it
 * replaces, which fill the disc either side of its head — it is the one face
 * here that is not a seat, and it does not have to match the room.
 *
 * Below the shoulders the borrowed shape is squared off and run to the bottom
 * of the plate: it tapers there, into the jacket notch and the hem it was
 * cropped at, and the circle is nowhere near done with it. The chat avatar has
 * the same taper and never shows it, because it is drawn wider than its disc
 * and pushed down until the taper falls out of the crop.
 */
export const PORTRAIT = {
  /** The impostor, still grinning: it got through the match. */
  robot: require('../../../assets/images/portraits/robot.png'),
  /** The impostor with its eyes crossed out: the room caught it. */
  robotOut: require('../../../assets/images/portraits/robot-out.png'),
  /** A person with their eyes crossed out: the room voted out one of its own. */
  misterOut: require('../../../assets/images/portraits/mister-out.png'),
} satisfies Record<string, ImageSourcePropType>;

export type Portrait = (typeof PORTRAIT)[keyof typeof PORTRAIT];

/**
 * The ground `PORTRAIT.robot` sits on where it is nobody's seat — the lineup on
 * the home screen, where the robot is the one face in the row that has no
 * colour of its own.
 */
export const ROBOT_GROUND = '#000000';

/** A portrait in a circle of one seat's colour, cropped like a chat avatar. */
export function FigureDisc({
  art,
  color,
  size,
  ring,
}: {
  art: Portrait;
  color: string;
  size: number;
  /** A border in this colour, to set the circle apart from what it sits on. */
  ring?: string;
}) {
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, backgroundColor: color },
        ring ? { borderWidth: Math.max(2, Math.round(size * 0.025)), borderColor: ring } : null,
      ]}>
      <Image source={art} style={{ width: size, height: size }} resizeMode="contain" />
    </View>
  );
}

const styles = StyleSheet.create({
  /** The plate is square and the circle is what crops it. */
  disc: {
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
