/**
 * What a screen is given: who you are, and a way to reach the match.
 *
 * Two things live here and nothing else. The profile, which is yours and
 * outlives any room, and a `MatchTransport`, which is whatever is currently
 * running matches. Today that is `useLocalTransport` — the whole simulation,
 * behind one interface. Pointing this at a server is a one-line change here.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { useLocalTransport } from './local-transport';
import { loadProfile, saveProfile, type Profile } from './profile';
import type { MatchTransport } from './transport';

/** How long a profile change settles before it is written to disk. */
const SAVE_DEBOUNCE_MS = 400;

type RoomContextValue = MatchTransport & {
  /** False until the stored profile has been read back. */
  hydrated: boolean;
  /** The name, or '' before the profile is read. */
  displayName: string;
  setName: (name: string) => void;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function RoomProvider({ children }: PropsWithChildren) {
  const [profile, setProfile] = useState<Profile | null>(null);

  // One read on launch, minting a profile the first time. Nothing renders the
  // game until this lands.
  useEffect(() => {
    let cancelled = false;
    loadProfile().then((loaded) => {
      if (!cancelled) setProfile(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Held briefly because the name field commits on every keystroke, and one
  // disk write per letter is not worth it.
  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void saveProfile(profile), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [profile]);

  const transport = useLocalTransport(profile);

  const setName = useCallback(
    (name: string) => setProfile((current) => (current ? { ...current, displayName: name } : current)),
    []
  );

  const value = useMemo(
    () => ({
      ...transport,
      hydrated: profile !== null,
      displayName: profile?.displayName ?? '',
      setName,
    }),
    [transport, profile, setName]
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

export function useRoomStore() {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error('useRoomStore must be used inside a RoomProvider');
  }
  return context;
}

/**
 * For screens under `/room/[id]` that cannot render without a room. Returns
 * null while the room is missing so the screen can redirect home.
 */
export function useRoom() {
  return useRoomStore().room;
}
