import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, BackHandler } from 'react-native';

import { useRoomStore } from '@/game/store';

/**
 * Every way out of a running match — the ✕, a header back arrow, and Android's
 * back button — goes through here, so none of them can drop you out of a game
 * you cannot rejoin without asking first.
 *
 * Pass `needsConfirm: false` once the match is decided; leaving then costs
 * nothing and a confirmation is just friction.
 */
export function useLeaveGame(needsConfirm = true) {
  const router = useRouter();
  const { send } = useRoomStore();

  const leave = useCallback(() => {
    send({ type: 'leave' });
    router.replace('/');
  }, [send, router]);

  const requestLeave = useCallback(() => {
    if (!needsConfirm) {
      leave();
      return;
    }
    Alert.alert('Leave the game?', 'You cannot rejoin. The round carries on without you.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: leave },
    ]);
  }, [needsConfirm, leave]);

  // The stack blocks the back *gesture*, but the hardware button still pops it.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        requestLeave();
        return true;
      });
      return () => subscription.remove();
    }, [requestLeave])
  );

  return requestLeave;
}
