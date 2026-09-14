/**
 * What a screen is given: who you are, and a way to reach the match.
 *
 * Two things live here and nothing else. The profile, which is yours and
 * outlives any room, and a `MatchTransport`, which is whatever is currently
 * running matches: `useLocalTransport` runs the whole game on this device, and
 * `useRemoteTransport` hands it to the game server. Screens cannot tell which.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { useLocalTransport } from './local-transport';
import { loadProfile, saveProfile, type Profile } from './profile';
import { GAME_URL, useRemoteTransport } from './remote-transport';
import type { MatchTransport } from './transport';

/**
 * Online when a game server is configured, on this device when it is not.
 *
 * Decided once, at load, because it is a build setting (`EXPO_PUBLIC_GAME_URL`
 * is inlined into the bundle) — and because a hook cannot be swapped for
 * another hook between renders.
 */
const useTransport = GAME_URL ? useRemoteTransport : useLocalTransport;

/** How long a profile change settles before it is written to disk. */
const SAVE_DEBOUNCE_MS = 400;

type RoomContextValue = MatchTransport & {
  /** False until the stored profile has been read back. */
  hydrated: boolean;
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

  // Nothing edits the profile any more, so this is one write behind the first
  // read — the mint. Kept debounced rather than inlined into `loadProfile`
  // because the shape is about to grow a server-issued token, and that will
  // change under the same rule: write it, briefly after it changes.
  useEffect(() => {
    if (!profile) return;
    const timer = setTimeout(() => void saveProfile(profile), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [profile]);

  const transport = useTransport(profile);

  const value = useMemo(
    () => ({
      ...transport,
      hydrated: profile !== null,
    }),
    [transport, profile]
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
