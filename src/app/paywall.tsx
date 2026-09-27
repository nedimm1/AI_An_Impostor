import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Purchases, { type PurchasesError, type PurchasesPackage } from 'react-native-purchases';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Screen } from '@/components/ui/screen';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Colors, Radius, Spacing } from '@/constants/theme';
import { planFor, type Plan } from '@/game/pro';
import { useRoomStore } from '@/game/store';

/**
 * The shop. Drawn here rather than by RevenueCat's paywall templates so it
 * looks like the rest of the game, and so the subscription can be the obvious
 * choice: it comes first, is picked already, and says "per month" in large
 * type rather than leaving the price to imply it.
 *
 * What is for sale still comes from RevenueCat — the default offering, with
 * its prices in the player's own currency — and so does the purchase. This
 * screen only decides how it looks. Whoever opened it (`pro.openPaywall`) is
 * told how it went when it closes.
 */
export default function PaywallScreen() {
  const router = useRouter();
  const { pro } = useRoomStore();
  const { closePaywall, refresh } = pro;

  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const show = useCallback((found: Plan[]) => {
    setPlans(found);
    setSelected((current) => current ?? found[0]?.pkg.identifier ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPlans()
      .then((found) => !cancelled && show(found))
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [show]);

  const retry = () => {
    setLoadFailed(false);
    fetchPlans()
      .then(show)
      .catch(() => setLoadFailed(true));
  };

  // Leaving by any route — the close button, the back gesture — tells whoever
  // opened it nothing was bought. After a purchase it has already been told,
  // and this does nothing.
  useEffect(() => () => closePaywall(false), [closePaywall]);

  // Once something is bought, the screen is done; `done` stops a second tap.
  const done = useRef(false);
  const finish = useCallback(
    async (bought: boolean) => {
      if (done.current) return;
      done.current = true;
      if (bought) await refresh();
      closePaywall(bought);
      router.back();
    },
    [closePaywall, refresh, router]
  );

  const buy = async (pkg: PurchasesPackage) => {
    setBusy(true);
    try {
      await Purchases.purchasePackage(pkg);
      await finish(true);
    } catch (e) {
      // Backing out of the store's own sheet is not an error worth showing.
      if (!(e as PurchasesError).userCancelled) {
        Alert.alert('Purchase failed', 'The purchase did not go through. Nothing was charged.');
      }
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      await Purchases.restorePurchases();
      await refresh();
      Alert.alert('Purchases restored', 'Anything you bought before is back.');
    } catch {
      Alert.alert('Could not restore', 'Could not restore purchases. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  const chosen = plans?.find((plan) => plan.pkg.identifier === selected) ?? null;

  return (
    <Screen>
      <ScreenHeader title="Get more matches" onBack={() => void finish(false)} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ThemedText type="title" style={styles.centered}>
          Keep playing
        </ThemedText>

        {plans === null && !loadFailed ? (
          <ActivityIndicator color={Colors.accent} style={styles.loading} />
        ) : loadFailed || plans?.length === 0 ? (
          <View style={styles.message}>
            <ThemedText type="body" themeColor="textSecondary" style={styles.centered}>
              The shop did not load. Check your connection and try again.
            </ThemedText>
            <Button label="Try again" variant="secondary" onPress={retry} />
          </View>
        ) : (
          <View style={styles.plans} accessibilityRole="radiogroup">
            {plans?.map((plan) => (
              <PlanCard
                key={plan.pkg.identifier}
                plan={plan}
                selected={plan.pkg.identifier === selected}
                active={plan.kind === 'unlimited' && pro.pro}
                onPress={() => setSelected(plan.pkg.identifier)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={chosen ? buyLabel(chosen) : 'Choose an option'}
          disabled={!chosen || (chosen.kind === 'unlimited' && pro.pro)}
          loading={busy}
          onPress={() => chosen && void buy(chosen.pkg)}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => void restore()}
          disabled={busy}
          hitSlop={8}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" themeColor="textSecondary" style={styles.centered}>
            Restore purchases
          </ThemedText>
        </Pressable>
      </View>
    </Screen>
  );
}

/** What the default offering sells, as plans this screen knows how to draw. */
async function fetchPlans() {
  const offerings = await Purchases.getOfferings();
  return (
    (offerings.current?.availablePackages ?? [])
      .map(planFor)
      .filter((plan): plan is Plan => plan !== null)
      // The subscription first, then packs from the biggest down.
      .sort((a, b) => rank(a) - rank(b))
  );
}

/** The subscription first, then the bigger pack before the smaller. */
function rank(plan: Plan) {
  return plan.kind === 'unlimited' ? -Infinity : -plan.matches;
}

function buyLabel(plan: Plan) {
  return plan.kind === 'unlimited'
    ? `Subscribe · ${plan.pkg.product.priceString} / month`
    : `Buy ${plan.matches} matches · ${plan.pkg.product.priceString}`;
}

function PlanCard({
  plan,
  selected,
  active,
  onPress,
}: {
  plan: Plan;
  selected: boolean;
  active: boolean;
  onPress: () => void;
}) {
  const unlimited = plan.kind === 'unlimited';
  const title = unlimited ? 'Unlimited' : `${plan.matches} matches`;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}, ${buyLabel(plan)}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        unlimited && styles.cardFeatured,
        selected && styles.cardSelected,
        pressed && styles.pressed,
      ]}>
      <View style={styles.cardTop}>
        <View style={styles.cardTitle}>
          <ThemedText type={unlimited ? 'subtitle' : 'bodyBold'}>{title}</ThemedText>
          {unlimited ? (
            <Pill label={active ? 'Active' : 'Monthly'} tone={active ? 'success' : 'accent'} />
          ) : null}
        </View>
        <View style={[styles.radio, selected && styles.radioSelected]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
      </View>

      <View style={styles.priceRow}>
        <ThemedText type={unlimited ? 'title' : 'subtitle'}>
          {plan.pkg.product.priceString}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {unlimited ? '/ month' : 'once'}
        </ThemedText>
      </View>

      {unlimited ? (
        <ThemedText type="small" themeColor="textSecondary">
          Play as much as you want, every day.
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  loading: {
    paddingVertical: Spacing.five,
  },
  message: {
    gap: Spacing.three,
    paddingVertical: Spacing.four,
  },
  centered: {
    textAlign: 'center',
  },
  plans: {
    gap: Spacing.three,
  },
  card: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.backgroundElement,
  },
  // The subscription is set apart even when it is not the one picked.
  cardFeatured: {
    paddingVertical: Spacing.four,
    backgroundColor: Colors.accentMuted,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.one,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: Colors.accent,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.accent,
  },
  footer: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
  },
  pressed: {
    opacity: 0.6,
  },
});
