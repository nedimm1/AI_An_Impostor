/**
 * OpenRouter, wearing the shape the impostor already talks to.
 *
 * `impostor.js` was written against the Anthropic SDK, and the interesting
 * part of it — the personas, the shape drawing, the two follow-up calls that
 * ask again when a line has a name in it or repeats itself — has nothing to do
 * with which company answers the request. So the provider change is made here
 * rather than there: this exposes `messages.create()`, takes the request the
 * impostor already builds, and translates it to OpenRouter's OpenAI-shaped
 * chat completions endpoint and back.
 *
 * The translation is small and worth knowing:
 *
 *   `system`            becomes a leading system message
 *   content blocks      flatten to text; nothing here sends images
 *   `cache_control`     dropped — OpenRouter does not sell caching on Gemma
 *   `output_config`     dropped — no thinking-effort dial on this model
 *   `usage`             renamed back to input_tokens / output_tokens
 *   `finish_reason`     renamed back to stop_reason
 *
 * It also collapses consecutive same-role messages. Gemma's chat template
 * wants strict user/assistant alternation, and the impostor's message builder
 * does not always produce it.
 */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Which of the fifteen providers serving this model are allowed to answer.
 *
 * This matters more than it looks. OpenRouter's default routing picked a
 * provider charging roughly $0.34 per million input tokens when the same
 * model is served at $0.09 — but the $0.09 endpoint, and the next one up,
 * serve **fp4**: the weights quantised to four bits. For a task that is
 * nothing but writing quality, buying a discount with precision is the wrong
 * trade, and it is invisible — a quantised model does not error, it just
 * writes slightly worse and you never find out why.
 *
 * So: a floor on precision first, cheapest within that floor second. As of
 * writing that lands on Venice at bf16 / $0.12 or DeepInfra at fp8 / $0.13,
 * still a third of what unpinned routing was costing.
 *
 * Set OPENROUTER_QUANTIZATIONS='' to allow anything, or name your own list.
 * None of this applies to the `:free` variant, which has exactly one provider.
 */
const QUANTIZATIONS =
  process.env.OPENROUTER_QUANTIZATIONS === undefined
    ? ['bf16', 'fp8']
    : process.env.OPENROUTER_QUANTIZATIONS.split(',')
        .map((name) => name.trim())
        .filter(Boolean);

/** The free pool is shared and busy. Worth a few tries before giving up. */
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const FIRST_BACKOFF_MS = 700;

/** Flatten Anthropic content — a string, or blocks — to plain text. */
function flatten(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && part.type === 'text') return part.text ?? '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * One system message, then strictly alternating turns.
 *
 * The impostor pushes a user message of what it has already said, an assistant
 * "ok" that used to be a cache breakpoint, then the turn itself — which does
 * alternate. The two follow-up calls append assistant-then-user, which also
 * does. This is here so a future edit to `buildMessages` cannot quietly break
 * the model's template.
 */
function toChatMessages(request) {
  const messages = [];

  if (request.system) {
    messages.push({ role: 'system', content: flatten(request.system) });
  }

  for (const message of request.messages ?? []) {
    const content = flatten(message.content);
    if (!content) continue;

    const previous = messages[messages.length - 1];

    if (previous && previous.role === message.role && previous.role !== 'system') {
      previous.content += `\n\n${content}`;
      continue;
    }

    messages.push({ role: message.role, content });
  }

  return messages;
}

/** `:free` picks the shared free pool, which has one provider and no choices. */
function isFree(model) {
  return typeof model === 'string' && model.endsWith(':free');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `stop` and `length` are the two that reach the caller as anything. */
function stopReasonOf(choice) {
  switch (choice?.finish_reason) {
    case 'length':
      return 'max_tokens';
    case 'stop':
      return 'end_turn';
    default:
      return choice?.finish_reason ?? null;
  }
}

class OpenRouter {
  constructor(options = {}) {
    this.apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    this.baseURL = options.baseURL ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL;

    /*
     * OpenRouter attributes traffic to an app by these two headers, and they
     * are the difference between "some key" and a named project in the
     * dashboard. Neither is required and neither is sent anywhere else.
     */
    this.referer = options.referer ?? process.env.OPENROUTER_SITE_URL ?? null;
    this.title = options.title ?? process.env.OPENROUTER_SITE_NAME ?? 'An Impostor';

    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set');
    }

    this.messages = { create: (request) => this.create(request) };
  }

  async create(request) {
    const body = {
      model: request.model,
      messages: toChatMessages(request),
      max_tokens: request.max_tokens,
    };

    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stop_sequences) body.stop = request.stop_sequences;

    /*
     * Precision floor, then price. See QUANTIZATIONS above for why the order
     * is that way round and not the other.
     *
     * Only on the paid variant. A `:free` model is served by exactly one
     * provider, which does not declare a quantization at all — so filtering
     * matches nothing and OpenRouter answers 404 "No endpoints found" rather
     * than falling back to the only endpoint there is. There is also nothing
     * to sort: one provider, at a price of zero.
     */
    if (!isFree(request.model)) {
      body.provider = { sort: 'price' };
      if (QUANTIZATIONS.length) body.provider.quantizations = QUANTIZATIONS;
    }

    /*
     * Fallback routing, if a list was configured. OpenRouter tries these in
     * order when the first is rate-limited, which on the free tier it often
     * is — see the note in `server/index.js`.
     */
    if (Array.isArray(request.fallbacks) && request.fallbacks.length) {
      body.models = [request.model, ...request.fallbacks];
    }

    const headers = {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
      'x-title': this.title,
    };
    if (this.referer) headers['http-referer'] = this.referer;

    let lastError = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(FIRST_BACKOFF_MS * 2 ** (attempt - 1));

      let response;
      try {
        response = await fetch(`${this.baseURL}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch (cause) {
        // A dropped connection is worth another try; a bad request is not.
        lastError = Object.assign(new Error(`could not reach openrouter: ${cause.message}`), {
          status: 503,
        });
        continue;
      }

      const payload = await response.json().catch(() => null);

      /*
       * OpenRouter answers 200 with an `error` object when the model is
       * reachable but the provider refused — a shared-pool 429 arrives this
       * way. So the status line is not enough to tell success from failure.
       */
      const failure = payload?.error ?? null;
      const status = failure?.code ?? (response.ok ? 200 : response.status);

      if (failure || !response.ok) {
        lastError = Object.assign(
          new Error(failure?.metadata?.raw ?? failure?.message ?? `openrouter returned ${status}`),
          { status }
        );
        if (RETRY_STATUSES.has(status)) continue;
        throw lastError;
      }

      const choice = payload?.choices?.[0];
      const usage = payload?.usage ?? {};

      return {
        // `message.reasoning` is deliberately ignored: some models put a
        // scratchpad there, and the room is only ever shown the message.
        content: [{ type: 'text', text: choice?.message?.content ?? '' }],
        stop_reason: stopReasonOf(choice),
        model: payload?.model ?? request.model,
        usage: {
          input_tokens: usage.prompt_tokens ?? 0,
          output_tokens: usage.completion_tokens ?? 0,
          cache_read_input_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
          cache_creation_input_tokens: usage.prompt_tokens_details?.cache_write_tokens ?? 0,
          cost: usage.cost ?? 0,
        },
      };
    }

    throw lastError ?? new Error('openrouter failed');
  }
}

module.exports = { OpenRouter, toChatMessages, flatten, isFree };
