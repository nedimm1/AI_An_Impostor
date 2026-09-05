/**
 * The one part of you that outlives a match.
 *
 * A room of strangers is disposable — you are matched, you play, it is gone.
 * The player is not. Reporting somebody, being reported, being kept out after
 * being reported enough: none of that works against a seat in a room, it works
 * against an account that is still there tomorrow. So the id is minted once on
 * this install and written to disk, and everything the server will later hang
 * off a player hangs off it.
 *
 * The name is stored beside it because it is the same lifetime, not because it
 * identifies anyone — names are typed by the player and are not unique.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/** Versioned so a later shape change can migrate rather than guess. */
const PROFILE_KEY = 'impostor.profile.v1';

export type Profile = {
  /**
   * Stable pseudonymous id for this install. Minted here for now; once there
   * is a server this is what it issues credentials against, and what a report
   * names. Never shown to another player.
   */
  playerId: string;
  /** What the room calls you. Yours to change, and not an identity. */
  displayName: string;
  /**
   * Credential from the server. Null until there is a server to issue one —
   * the field exists so the storage shape does not have to change when there
   * is, not because anything mints it yet.
   */
  authToken: string | null;
  createdAt: number;
};

export function newProfile(): Profile {
  return {
    playerId: Crypto.randomUUID(),
    displayName: '',
    authToken: null,
    createdAt: Date.now(),
  };
}

/** Enough of a check that a corrupt or half-written record is thrown away. */
function isProfile(value: unknown): value is Profile {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Partial<Profile>;
  return (
    typeof p.playerId === 'string' &&
    p.playerId.length > 0 &&
    typeof p.displayName === 'string' &&
    (p.authToken === null || typeof p.authToken === 'string') &&
    typeof p.createdAt === 'number'
  );
}

/**
 * Reads the stored profile, minting one on first launch. A read that fails or
 * comes back unusable is treated as a first launch: a fresh id is worse than a
 * remembered one, but it is better than an app that will not open.
 */
export async function loadProfile(): Promise<Profile> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isProfile(parsed)) return parsed;
    }
  } catch {
    // Fall through to a fresh profile.
  }

  const profile = newProfile();
  await saveProfile(profile);
  return profile;
}

/**
 * Writes the profile back. Failing to save is not worth interrupting a game
 * for — the in-memory profile still works for this session, and the next write
 * gets another go.
 */
export async function saveProfile(profile: Profile): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Storage is unavailable. The session continues unpersisted.
  }
}
