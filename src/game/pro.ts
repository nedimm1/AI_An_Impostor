/**
 * Paying for matches: a few free every day, then packs, or unlimited.
 *
 *   free         3 matches a day
 *   matches_20   $2.99        20 matches, consumable
 *   matches_100  $9.99        100 matches, consumable (`matches_hundered` in the dashboard)
 *   Unlimited    $4.99/month  unlimited while subscribed
 *
 * WHY MATCHES. Every match costs real money — the impostor is a paid model
 * answering on every one of its turns (`server/impostor.js`) — so the thing
 * worth paying for is more of them. Nothing about a match changes with a
 * purchase: the room cannot tell who paid, which is the only fair way to sell
 * anything in a game played against strangers.
 *
 * RevenueCat owns what was bought and what is for sale (the default offering,
 * shown by `app/paywall.tsx`):
 * the `unlimited` entitlement (the subscription) makes you unlimited, and every
 * pack purchase in `nonSubscriptionTransactions` adds its matches. This file
 * owns what has been used: free matches per calendar day are spent first,
 * bought ones after.
 *
 * COUNTED ON THE PHONE. A reinstall forgets what was used — the free matches
 * reset, and bought packs come back full. That is an honest trade for now:
 * the server does not know who paid, and teaching it would mean verifying
 * purchases server-side (RevenueCat's virtual currencies are built for this).
 * Move the count there once it matters.
 *
 * With no `EXPO_PUBLIC_REVENUECAT_API_KEY` set, or in Expo Go, there is
 * nothing to buy, so there is no limit either — the game still runs from a
 * fresh clone.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import { router } from 'expo-router';
import Purchases, {
  LOG_LEVEL,
  PRODUCT_CATEGORY,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

/** Free matches a day, spent before bought ones. */
export const FREE_MATCHES_PER_DAY = 3;

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_API_KEY ?? '';

/**
 * Whether this binary has RevenueCat's native module — a development or store
 * build does, Expo Go does not. Without it the SDK falls back to a browser
 * mode that cannot draw a paywall on a phone, which would leave a player out
 * of free matches facing a paywall that never opens. The same check the SDK
 * makes for itself.
 */
const NATIVE_PURCHASES = !!NativeModules.RNPurchases;

/** Versioned so a later shape change can migrate rather than guess. */
const USAGE_KEY = 'impostor.matchUsage.v2';

/**
 * The entitlement that means unlimited matches — granted by the monthly
 * subscription, and active only while it is paid up. Also accepted as a
 * product identifier, for a one-time unlock sold under the same name.
 */
export const UNLIMITED = 'unlimited';

/** Consumable product identifier → matches it adds. */
export const MATCH_PACKS: Record<string, number> = {
  matches_20: 20,
  matches_100: 100,
  // The identifier the 100-pack was created under in the dashboard. Test Store
  // identifiers cannot be renamed, so the code takes the spelling as it is.
  matches_hundered: 100,
};

type Usage = {
  /** Local calendar day, `YYYY-MM-DD`. A new day gives the free matches back. */
  day: string;
  /** Free matches played today. */
  freeUsed: number;
  /** Bought matches played, ever. Never resets: packs do not expire. */
  paidUsed: number;
  /** The last match counted, so seeing the same room twice counts once. */
  lastRoomId: string | null;
};

function today() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Rolled over to today: free matches come back, bought ones stay spent. */
function onToday(usage: Usage): Usage {
  return usage.day === today() ? usage : { ...usage, day: today(), freeUsed: 0 };
}

async function loadUsage(): Promise<Usage> {
  try {
    const raw = await AsyncStorage.getItem(USAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Usage>;
      if (
        typeof parsed.day === 'string' &&
        typeof parsed.freeUsed === 'number' &&
        typeof parsed.paidUsed === 'number'
      ) {
        return onToday({
          day: parsed.day,
          freeUsed: parsed.freeUsed,
          paidUsed: parsed.paidUsed,
          lastRoomId: parsed.lastRoomId ?? null,
        });
      }
    }
  } catch {
    // Unreadable: start again rather than lock anybody out.
  }
  return { day: today(), freeUsed: 0, paidUsed: 0, lastRoomId: null };
}

function saveUsage(usage: Usage) {
  AsyncStorage.setItem(USAGE_KEY, JSON.stringify(usage)).catch(() => {
    // Not worth interrupting a game for. The count holds for this session.
  });
}

/**
 * Whether an identifier is `unlimited`. Case-insensitive: the dashboard shows
 * display names beside identifiers, and "Unlimited" vs "unlimited" should not
 * be the difference between a purchase counting and not. Google Play appends
 * `:base-plan` to subscription identifiers, which is dropped.
 */
const named = (id: string) => id.toLowerCase().split(':')[0] === UNLIMITED;

/** Unlimited right now: the `unlimited` entitlement, a live subscription by that name, or a one-time unlock. */
function isUnlimited(info: CustomerInfo) {
  return (
    Object.keys(info.entitlements.active).some(named) ||
    // Only live ones: a lapsed subscription is still in the purchase history.
    info.activeSubscriptions.some(named) ||
    info.nonSubscriptionTransactions.some((t) => named(t.productIdentifier))
  );
}

/** Every match ever bought in packs. Consumables stay in the history, so this only grows. */
function matchesBought(info: CustomerInfo) {
  return info.nonSubscriptionTransactions.reduce(
    (sum, t) => sum + (MATCH_PACKS[t.productIdentifier] ?? 0),
    0
  );
}

/** What a package on the paywall is: the subscription, a pack of matches, or neither. */
export type Plan =
  | { kind: 'unlimited'; pkg: PurchasesPackage }
  | { kind: 'pack'; pkg: PurchasesPackage; matches: number };

export function planFor(pkg: PurchasesPackage): Plan | null {
  const product = pkg.product;
  if (product.productCategory === PRODUCT_CATEGORY.SUBSCRIPTION || named(product.identifier)) {
    return { kind: 'unlimited', pkg };
  }
  const matches = MATCH_PACKS[product.identifier];
  return matches ? { kind: 'pack', pkg, matches } : null;
}

/** What RevenueCat says this player owns, in the Metro terminal. Development only. */
function logCustomer(info: CustomerInfo) {
  if (!__DEV__) return;
  console.log(
    `[pro] ${info.originalAppUserId} entitlements=${JSON.stringify(Object.keys(info.entitlements.active))}` +
      ` purchases=${JSON.stringify(info.nonSubscriptionTransactions.map((t) => t.productIdentifier))}` +
      ` → unlimited=${isUnlimited(info)} bought=${matchesBought(info)}`
  );
}

export type ProState = {
  /** False when no RevenueCat key is set, or in Expo Go: no paywall, no limit. */
  enabled: boolean;
  /** Unlimited matches right now (the monthly subscription). */
  pro: boolean;
  /** Free matches left today. */
  freeLeft: number;
  /** Bought matches not yet played. */
  paidLeft: number;
  /** Whether a new match may start now. */
  canPlay: boolean;
  /** Shows the paywall. Resolves true when something was bought or restored. */
  openPaywall: () => Promise<boolean>;
  /**
   * The paywall screen is done: `true` when something was bought or restored.
   * Resolves whoever opened it. Safe to call more than once; the first wins.
   */
  closePaywall: (bought: boolean) => void;
  /** Reads what this player owns back from RevenueCat, after a purchase. */
  refresh: () => Promise<void>;
};

/**
 * Set up once the player id is known, so purchases hang off the same id the
 * game server knows this player by. Counts a match whenever `roomId` changes
 * to one it has not counted.
 */
export function usePro(playerId: string | null, roomId: string | null): ProState {
  const enabled = API_KEY !== '' && NATIVE_PURCHASES;
  const [info, setInfo] = useState<CustomerInfo | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const configured = useRef(false);

  useEffect(() => {
    if (!enabled || !playerId) return;
    // Configured once per launch; the listener below comes and goes with the effect.
    if (!configured.current) {
      configured.current = true;
      if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
      Purchases.configure({ apiKey: API_KEY, appUserID: playerId });
    }

    const listener = (next: CustomerInfo) => {
      logCustomer(next);
      setInfo(next);
    };
    Purchases.addCustomerInfoUpdateListener(listener);
    Purchases.getCustomerInfo()
      .then(listener)
      .catch(() => {
        // Offline or misconfigured: stay free, and the listener catches up later.
      });
    return () => {
      Purchases.removeCustomerInfoUpdateListener(listener);
    };
  }, [enabled, playerId]);

  useEffect(() => {
    let cancelled = false;
    loadUsage().then((loaded) => {
      if (!cancelled) setUsage(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pro = info !== null && isUnlimited(info);
  const bought = info === null ? 0 : matchesBought(info);

  // A room turning up is a match starting, paid for from today's free matches
  // first and bought ones after — nothing, when unlimited. Waits for the
  // stored usage, so a room that arrives first is not counted against a blank
  // record. Adjusted during render rather than in an effect, as React
  // recommends for state that follows a prop.
  if (roomId && usage && usage.lastRoomId !== roomId) {
    const current = onToday(usage);
    const spend = pro
      ? {}
      : current.freeUsed < FREE_MATCHES_PER_DAY
        ? { freeUsed: current.freeUsed + 1 }
        : { paidUsed: current.paidUsed + 1 };
    setUsage({ ...current, ...spend, lastRoomId: roomId });
  }

  useEffect(() => {
    if (usage) saveUsage(usage);
  }, [usage]);

  // The paywall is its own screen (`app/paywall.tsx`), so whoever opened it
  // waits on this until the screen says how it went.
  const waiting = useRef<((bought: boolean) => void) | null>(null);

  const closePaywall = useCallback((bought: boolean) => {
    waiting.current?.(bought);
    waiting.current = null;
  }, []);

  const openPaywall = useCallback(() => {
    if (!enabled) return Promise.resolve(true);
    // A paywall already open answers "no" to whoever opened it first.
    closePaywall(false);
    return new Promise<boolean>((resolve) => {
      waiting.current = resolve;
      router.push('/paywall');
    });
  }, [enabled, closePaywall]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      // Read back straight away rather than trusting the update listener to fire.
      const next = await Purchases.getCustomerInfo();
      logCustomer(next);
      setInfo(next);
    } catch {
      // The listener catches up when the connection does.
    }
  }, [enabled]);

  // Yesterday's free matches are today's, even if the app stayed open overnight.
  const current = usage ? onToday(usage) : null;
  const freeLeft = Math.max(0, FREE_MATCHES_PER_DAY - (current?.freeUsed ?? 0));
  const paidLeft = Math.max(0, bought - (current?.paidUsed ?? 0));

  // One object per change rather than per render: the store's context value
  // depends on it, and every screen re-renders when that changes.
  return useMemo(
    () => ({
      enabled,
      pro,
      freeLeft,
      paidLeft,
      canPlay: !enabled || pro || freeLeft > 0 || paidLeft > 0,
      openPaywall,
      closePaywall,
      refresh,
    }),
    [enabled, pro, freeLeft, paidLeft, openPaywall, closePaywall, refresh]
  );
}
