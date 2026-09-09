/**
 * The provider change lives entirely in the translation, so the translation is
 * what is worth testing. These run without a network: what goes wrong here is
 * a message shape the model quietly mishandles, not a failed request.
 */

const { toChatMessages, flatten } = require('./openrouter');

describe('flatten', () => {
  test('a string passes through', () => {
    expect(flatten('hello')).toBe('hello');
  });

  test('text blocks join, and cache_control is dropped with them', () => {
    expect(
      flatten([
        { type: 'text', text: 'one' },
        { type: 'text', text: 'two', cache_control: { type: 'ephemeral' } },
      ])
    ).toBe('one\ntwo');
  });

  test('an array of plain strings still joins', () => {
    expect(flatten(['one', 'two'])).toBe('one\ntwo');
  });

  test('nothing at all is empty, not a crash', () => {
    expect(flatten(undefined)).toBe('');
    expect(flatten(null)).toBe('');
  });
});

describe('toChatMessages', () => {
  test('the system prompt becomes the first message', () => {
    const messages = toChatMessages({
      system: 'you are a person',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(messages).toEqual([
      { role: 'system', content: 'you are a person' },
      { role: 'user', content: 'hi' },
    ]);
  });

  test('no system prompt means no system message', () => {
    expect(toChatMessages({ messages: [{ role: 'user', content: 'hi' }] })).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  /*
   * Gemma's template wants the turns to alternate. Two user messages in a row
   * is the failure this collapse exists to prevent, and it is the shape
   * `buildMessages` would produce if the "ok" acknowledgement were ever
   * removed from it.
   */
  test('consecutive same-role messages collapse into one', () => {
    const messages = toChatMessages({
      messages: [
        { role: 'user', content: 'what you said before' },
        { role: 'user', content: 'the question' },
      ],
    });

    expect(messages).toEqual([{ role: 'user', content: 'what you said before\n\nthe question' }]);
  });

  test('a genuine alternation is left alone', () => {
    const messages = toChatMessages({
      system: 'rules',
      messages: [
        { role: 'user', content: 'memory' },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
        { role: 'user', content: 'the question' },
      ],
    });

    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[2]).toEqual({ role: 'assistant', content: 'ok' });
  });

  test('the follow-up call that asks again alternates too', () => {
    const messages = toChatMessages({
      system: 'rules',
      messages: [
        { role: 'user', content: 'the question' },
        { role: 'assistant', content: 'nedim is right' },
        { role: 'user', content: 'that has a name in it' },
      ],
    });

    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  test('an empty message is dropped rather than sent blank', () => {
    const messages = toChatMessages({
      messages: [
        { role: 'user', content: 'real' },
        { role: 'assistant', content: '' },
        { role: 'user', content: 'also real' },
      ],
    });

    // The blank assistant turn goes, and the two user turns then collapse —
    // which is the right answer: an empty turn is not a turn.
    expect(messages).toEqual([{ role: 'user', content: 'real\n\nalso real' }]);
  });
});

/*
 * The provider filter is for the paid variant only.
 *
 * Applying it to `:free` asked OpenRouter for a bf16/fp8 endpoint of a model
 * served by one provider that declares no quantization, and got back a 404
 * with no endpoints — which reached the room as a stock line. The comment
 * said this; the code did not.
 */
describe('isFree', () => {
  const { isFree } = require('./openrouter');

  test('the free variant is recognised', () => {
    expect(isFree('google/gemma-4-31b-it:free')).toBe(true);
  });

  test('the paid variant is not', () => {
    expect(isFree('google/gemma-4-31b-it')).toBe(false);
  });

  test('a batch variant is not free either', () => {
    expect(isFree('google/gemma-4-31b-it:batch')).toBe(false);
  });

  test('a missing model does not throw', () => {
    expect(isFree(undefined)).toBe(false);
  });
});
