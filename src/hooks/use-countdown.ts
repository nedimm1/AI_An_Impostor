import { useEffect, useRef, useState } from 'react';

/**
 * Ticks once a second toward `endsAt` (epoch ms). Returns seconds remaining,
 * clamped at zero. Passing null stops the timer and returns null.
 */
export function useCountdown(endsAt: number | null, onEnd?: () => void) {
  const [remaining, setRemaining] = useState(() =>
    endsAt === null ? null : Math.max(0, Math.round((endsAt - Date.now()) / 1000))
  );

  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

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
  }, [endsAt]);

  return remaining;
}

export function formatClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
