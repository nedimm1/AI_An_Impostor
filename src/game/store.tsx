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
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { useLocalTransport } from './local-transport';
import { usePro, type ProState } from './pro';
import { loadProfile, saveProfile, type Profile } from './profile';
import { GAME_URL, useRemoteTransport } from './remote-transport';
import type { MatchTransport } from './transport';
import type { RoomSize } from './types';

/**
 * Online when a game server is configured, on this device when it is not.
 *
 * Decided once, at load, because it is a build setting (`EXPO_PUBLIC_GAME_URL`
 * is inlined into the bundle) — and because a hook cannot be swapped for
 * another hook between renders.
 */
/*
 * With no server configured, a release build would play the whole match on
 * this device against bots while the screens said "finding strangers" — the
 * one promise this game makes, broken silently, and indistinguishable from
 * working. It is the failure a deploy makes likely, because the URL is
 * inlined at build time and a release built without it looks fine until
 * someone notices their opponents are not real. So it refuses to start.
 *
 * `__DEV__` is left alone: on this machine the local transport is the point,
 * and it is how the game is played without a server running.
 */
if (!GAME_URL && !__DEV__) {
  throw new Error(
    'EXPO_PUBLIC_GAME_URL is not set. This build would run every match ' +
      'locally against bots while telling the player they had been matched ' +
      'with strangers, so it refuses to start instead. Set it to the game ' +
      "server's wss:// address and build again."
  );
}

const useTransport = GAME_URL ? useRemoteTransport : useLocalTransport;

/** How long a profile change settles before it is written to disk. */
const SAVE_DEBOUNCE_MS = 400;

type RoomContextValue = MatchTransport & {
  /** False until the stored profile has been read back. */
  hydrated: boolean;
  /**
   * The room size picked on the home screen, which the queue asks for. Kept
   * here rather than passed between screens so "Find another game" at the end
   * of a match asks for the same size without anyone having to carry it.
   */
  roomSize: RoomSize;
  setRoomSize: (size: RoomSize) => void;
  /** Impostor Pro and today's free matches (`pro.ts`). */
  pro: ProState;
  /**
   * Whether a new match may start, showing the paywall first when today's free
   * matches are used up. Every "play" button asks this before the queue.
   */
  requestPlay: () => Promise<boolean>;
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

  // Five by default: the full game, and the one the rules were tuned for.
  const [roomSize, setRoomSize] = useState<RoomSize>(5);

  const pro = usePro(profile?.playerId ?? null, transport.room?.id ?? null);
  const { canPlay, openPaywall } = pro;
  const requestPlay = useCallback(
    async () => canPlay || (await openPaywall()),
    [canPlay, openPaywall]
  );

  // Every match request says whether you subscribe, so your seat wears the
  // red star (`Player.star`). Screens just ask for a size.
  const { findMatch: transportFindMatch } = transport;
  const subscribed = pro.pro;
  const findMatch = useCallback(
    (size: RoomSize) => transportFindMatch(size, subscribed),
    [transportFindMatch, subscribed]
  );

  const value = useMemo(
    () => ({
      ...transport,
      findMatch,
      hydrated: profile !== null,
      roomSize,
      setRoomSize,
      pro,
      requestPlay,
    }),
    [transport, findMatch, profile, roomSize, pro, requestPlay]
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
