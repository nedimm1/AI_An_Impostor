/**
 * Test mode: you play the room, the model plays the impostor.
 *
 * The point of it is to take the stand-ins out of the way. Their stock lines
 * are prompt-agnostic filler — "genuinely cannot answer this without starting
 * an argument" — and next to a model that actually answers the question they
 * are the conspicuous thing in the room, which makes every read of the
 * impostor's writing a read of the wrong problem. Typing the other six answers
 * yourself puts real answers around it, and then what the impostor writes can
 * be judged against something worth judging it against.
 *
 * The clock is not one of the things it changes. It was, briefly, on the
 * grounds that six seats at forty seconds is a typing exercise rather than a
 * test — but the impostor is being read against a deadline it was told about
 * ("you have roughly 40 seconds to type"), and a harness that quietly removes
 * that deadline is not reading the player the room will meet. So every turn is
 * timed here exactly as it is in a match, yours and the seats you are typing
 * included, with one exception: the impostor is not allowed to draw a turn it
 * sits out. Missing turns is human and stays in the game; a missed turn here
 * is just a turn of evidence thrown away.
 *
 * It is a testing harness, not a game mode, and everything it changes is
 * changed in one of the four places that check `TEST_MODE`. Off, the game is
 * byte for byte what it was.
 *
 * Start `npm run impostor:server` first, then the app with the harness on:
 *
 *   npm run ios:test        # EXPO_PUBLIC_IMPOSTOR_URL=http://localhost:8787
 *   npm run android:test    # EXPO_PUBLIC_IMPOSTOR_URL=http://10.0.2.2:8787
 *
 * The two differ only in how the emulator reaches the host: `10.0.2.2` is the
 * Android emulator's alias for it and does not resolve on the iOS simulator,
 * which sees the host as `localhost`. Getting that wrong is quiet rather than
 * loud — the impostor just falls back to a stock line, exactly as it would if
 * the server were down — so it is worth using the scripts rather than typing
 * the URL from memory.
 */

/**
 * Inlined at bundle time, like every `EXPO_PUBLIC_` value — so this is a build
 * flag, not a runtime setting, and a production bundle cannot be talked into
 * it.
 */
export const TEST_MODE = process.env.EXPO_PUBLIC_TEST_MODE === '1';

/**
 * What the impostor's seat is called while testing.
 *
 * It is a real rename rather than a label over the top, which is worth being
 * clear about: this name is what the room shows, *and* what the model is told
 * it is called, *and* what its own lines come back to it under. That is only
 * safe because it was measured — asked the same prompts as Mr. Teal and as AI,
 * the answers were indistinguishable ("cold pizza" / "cold sausage roll",
 * "whistling backwards, badly but loud" / "whistling backwards, badly"). It
 * reads the name as a chat handle and carries on.
 *
 * If that ever stops being true the fix is not a cleverer name — it is to stop
 * renaming the seat and label it in the UI instead.
 */
export const IMPOSTOR_NAME = 'AI';
