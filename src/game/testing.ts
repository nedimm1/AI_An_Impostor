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
 * It is a testing harness, not a game mode, and everything it changes is
 * changed in one of the four places that check `TEST_MODE`. Off, the game is
 * byte for byte what it was.
 *
 *   EXPO_PUBLIC_TEST_MODE=1 EXPO_PUBLIC_IMPOSTOR_URL=http://10.0.2.2:8787 npx expo start --android
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
 * safe because it was measured — asked the same prompts as Deniz and as AI,
 * the answers were indistinguishable ("cold pizza" / "cold sausage roll",
 * "whistling backwards, badly but loud" / "whistling backwards, badly"). It
 * reads the name as a chat handle and carries on.
 *
 * If that ever stops being true the fix is not a cleverer name — it is to stop
 * renaming the seat and label it in the UI instead.
 */
export const IMPOSTOR_NAME = 'AI';
