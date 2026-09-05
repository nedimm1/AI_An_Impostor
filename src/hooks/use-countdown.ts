import { useEffect, useRef, useState } from 'react';

import { useResumeSignal } from './use-app-state';

/**
 * Ticks once a second toward `endsAt` (epoch ms). Returns seconds remaining,
 * clamped at zero. Passing null stops the timer and returns null.
 *
 * Every tick is worked out from `endsAt` rather than counted down, so an
 * interval that was throttled or frozen while the app was away comes back
 * showing the truth instead of where it left off.
 */
export function useCountdown(endsAt: number | null, onEnd?: () => void) {
  const [remaining, setRemaining] = useState(() =>
    endsAt === null ? null : Math.max(0, Math.round((endsAt - Date.now()) / 1000))
  );

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Re-reads the clock the moment the app is back, rather than showing a stale
  // number until the next tick comes round.
  const resumedAt = useResumeSignal();

  useEffect(() => {
    if (endsAt === null) {
      setRemaining(null);
      return;
    }

    let fired = false;
    const tick = () => {
      const next = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0 && !fired) {
        fired = true;
        onEndRef.current?.();
      }
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt, resumedAt]);

  return remaining;
}

export function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
