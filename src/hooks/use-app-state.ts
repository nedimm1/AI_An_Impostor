/**
 * When the app last came back to the foreground.
 *
 * Backgrounded, the JS timers that drive a match are not reliable: iOS
 * suspends them outright and Android throttles or freezes them under Doze. So
 * nothing in a room should be *kept* true by a timer having fired on time.
 * Every deadline is an absolute moment, and coming back is the cue to work out
 * again what should already have happened.
 *
 * Returns a value that changes on each return to the foreground, so an effect
 * can simply list it as a dependency and be re-run.
 */

import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useResumeSignal() {
  const [resumedAt, setResumedAt] = useState(() => Date.now());

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;

    const subscription = AppState.addEventListener('change', (next) => {
      // 'inactive' is the shade being pulled down or a call arriving — a
      // moment of not-quite-away that is not worth re-deriving a room over.
      const returning = next === 'active' && previous === 'background';
      previous = next;
      if (returning) setResumedAt(Date.now());
    });

    return () => subscription.remove();
  }, []);

  return resumedAt;
}
