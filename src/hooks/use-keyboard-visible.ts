/**
 * Whether the on-screen keyboard is up.
 *
 * For space kept clear of the system's own bars: while the keyboard is up it
 * covers the navigation bar, so padding kept for that bar becomes a gap
 * between the keyboard and whatever sits on it.
 *
 * `Did` rather than `Will`, because Android only sends the `Did` events.
 */

import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export function useKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return visible;
}
