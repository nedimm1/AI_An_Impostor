/**
 * The free-match counter: one match, counted once — however many times the
 * same room is seen, and in React's strict mode, which renders twice.
 */

import { act, create } from 'react-test-renderer';
import { StrictMode } from 'react';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    setLogLevel: jest.fn(),
    configure: jest.fn(),
    addCustomerInfoUpdateListener: jest.fn(),
    removeCustomerInfoUpdateListener: jest.fn(),
    getCustomerInfo: jest.fn(() => new Promise(() => {})),
  },
  LOG_LEVEL: { WARN: 'WARN' },
  PRODUCT_CATEGORY: { SUBSCRIPTION: 'SUBSCRIPTION', NON_SUBSCRIPTION: 'NON_SUBSCRIPTION' },
}));

// Read by `pro.ts` when it loads: a key, and a binary with the native module.
process.env.EXPO_PUBLIC_REVENUECAT_API_KEY = 'test_key';
require('react-native').NativeModules.RNPurchases = {};
const { usePro } = require('./pro') as typeof import('./pro');

describe('free matches', () => {
  beforeEach(async () => {
    await require('@react-native-async-storage/async-storage').clear();
  });

  it('counts a match once, however often its room is seen', async () => {
    let left = -1;
    function Probe({ roomId }: { roomId: string | null }) {
      left = usePro('player-1', roomId).freeLeft;
      return null;
    }

    let root!: ReturnType<typeof create>;
    const show = async (roomId: string | null) => {
      await act(async () => {
        const tree = (
          <StrictMode>
            <Probe roomId={roomId} />
          </StrictMode>
        );
        if (root) root.update(tree);
        else root = create(tree);
      });
    };

    await show(null);
    expect(left).toBe(3);

    await show('room-a'); // the match starts
    expect(left).toBe(2);

    await show('room-a'); // the same room again: a reconnect, a re-render
    await show(null); // left, or the match ended
    await show('room-a'); // back in the same room
    expect(left).toBe(2);

    await show('room-b'); // the next match
    expect(left).toBe(1);
  });
});
