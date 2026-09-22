"use strict";

const { TokenBucketQueue } = require("./rateLimiter");

const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";

class SarvamClient {
  constructor({ apiKey, model, ratePerMinute }) {
    this.apiKey = apiKey;
    this.model = model || "sarvam-105b";
    this.queue = new TokenBucketQueue({ ratePerMinute: ratePerMinute || 35 });
    // No real key configured -> Setu still runs, using a deterministic mock
    // so the whole pipeline (routing, session state, dashboard) can be
    // demoed and load-tested without burning real credits or a signup first.
    this.mockMode = !apiKey || apiKey.trim() === "" || apiKey.includes("your_key_here");
  }

  get queueDepth() {
    return this.queue.pending;
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} opts
   * @returns {Promise<string>} raw model text
   */
  async complete(messages, opts = {}) {
    if (this.mockMode) return this._mockComplete(messages);

    await this.queue.acquire();

    const body = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 600,
    };
    if (opts.reasoningEffort !== undefined) body.reasoning_effort = opts.reasoningEffort;
    if (opts.responseFormat) body.response_format = opts.responseFormat;

    const maxAttempts = 3;
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(SARVAM_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-subscription-key": this.apiKey,
          },
          body: JSON.stringify(body),
        });

        if (res.status === 429 || res.status >= 500) {
          // Rate-limited or a transient server hiccup — back off and retry
          // rather than surfacing a failure straight to the user.
          const waitMs = 300 * 2 ** (attempt - 1);
          await new Promise((r) => setTimeout(r, waitMs));
          lastErr = new Error(`Sarvam returned ${res.status}`);
          continue;
        }

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Sarvam ${res.status}: ${text.slice(0, 300)}`);
        }

        const data = await res.json();
        const message = data?.choices?.[0]?.message;
        // Some Sarvam-105B responses spend the first completion budget on
        // reasoning and leave content null. Preserve it so JSON extraction can
        // still recover a completed object when the model includes one there.
        return message?.content ?? (opts.allowReasoningFallback ? message?.reasoning_content : "") ?? "";
      } catch (err) {
        lastErr = err;
        if (attempt === maxAttempts) throw err;
      }
    }
    throw lastErr;
  }

  /** Deterministic offline stand-in so the app is fully runnable without a key. */
  async _mockComplete(messages) {
    const last = messages[messages.length - 1]?.content || "";
    const looksHindi = /[\u0900-\u097F]/.test(last);
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 300));

    if (messages[0]?.content?.includes("Respond with ONLY a JSON object")) {
      const urgent = /urgent|emergency|turant|jaldi|fraud|fail(?:ed)?|down|not working/i.test(last);
      return JSON.stringify({
        language: looksHindi ? "hi" : "en",
        intent: urgent ? "complaint" : "query",
        category: "general",
        urgency: urgent ? "high" : "low",
        sentiment: urgent ? "negative" : "neutral",
        confidence: 0.62,
      });
    }

    return looksHindi
      ? "Main samajh gaya. Aapki baat dhyan se sun li hai — kripya thoda aur detail bataiye taaki main sahi tarike se madad kar sakun. (mock reply — no SARVAM_API_KEY set)"
      : "Got it — I've noted your message. Could you share a bit more detail so I can help precisely? (mock reply — no SARVAM_API_KEY set)";
  }
}

module.exports = { SarvamClient };
