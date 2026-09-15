import { Image, StyleSheet, View } from 'react-native';

import { Colors, Radius } from '@/constants/theme';

/**
 * One picture per way a vote can end, so the result lands before anyone reads a
 * word of it.
 *
 * Each is a cutout of the figure with the black suit kept solid and only the
 * ground around it transparent, drawn the way a chat avatar is: a circle of the
 * seat's colour with the figure large and cropped at the shoulders. They were
 * transparent all the way through at first, and the seat colour showed through
 * the suit and swallowed the figure.
 *
 * `widthK` and `shiftK` are the crop, as fractions of the circle — matched by
 * eye against `Avatar`, which uses 1.15 and 0.18 for the plain figure. The
 * robots are taller (the antenna), so they are drawn a little smaller to keep
 * the antenna inside the circle. Each shift puts the bottom of the picture just
 * past the bottom of the circle, so the suit is cut by the curve rather than
 * ending on a flat edge.
 */
export const VERDICT_ART = {
  impostorWins: {
    source: require('../../../assets/images/verdicts/impostor-wins.png'),
    aspect: 813 / 600,
    widthK: 0.7,
    shiftK: 0.041,
  },
  impostorCaught: {
    source: require('../../../assets/images/verdicts/impostor-caught.png'),
    aspect: 793 / 600,
    widthK: 0.7,
    shiftK: 0.041,
  },
  notTheImpostor: {
    source: require('../../../assets/images/verdicts/not-the-impostor.png'),
    aspect: 673 / 600,
    widthK: 0.8,
    shiftK: 0.066,
  },
};

export type Art = (typeof VERDICT_ART)[keyof typeof VERDICT_ART];

/** A picture in a circle of one seat's colour, cropped like a chat avatar. */
export function FigureDisc({
  art,
  color,
  size,
  ring,
}: {
  art: Art;
  color: string;
  size: number;
  /** A border in this colour, to set the circle apart from what it sits on. */
  ring?: string;
}) {
  const width = size * art.widthK;
  return (
    <View
      style={[
        styles.disc,
        { width: size, height: size, backgroundColor: color || Colors.backgroundSelected },
        ring ? { borderWidth: Math.max(2, Math.round(size * 0.025)), borderColor: ring } : null,
      ]}>
      <Image
        source={art.source}
        style={{
          width,
          height: width * art.aspect,
          transform: [{ translateY: size * art.shiftK }],
        }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /** Mirrors `Avatar`: the circle crops a figure larger than itself. */
  disc: {
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
