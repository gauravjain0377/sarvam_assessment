"use strict";

/**
 * A token-bucket limiter with a FIFO wait queue.
 *
 * Sarvam's Starter plan caps sarvam-105b at 40 req/min (their
 * smaller default chat models get 60 — check docs.sarvam.ai/api/ratelimits
 * before assuming this number). Rather than fire
 * calls and hope, every outbound request to Sarvam goes through here first.
 * Tokens refill continuously (not in one lump at the top of the minute),
 * which is the same model Sarvam's own docs describe for their limits —
 * so this queue mirrors the constraint it's protecting against instead of
 * just guessing at it.
 */
class TokenBucketQueue {
  constructor({ ratePerMinute, bucketSize }) {
    this.capacity = bucketSize ?? ratePerMinute;
    this.tokens = this.capacity;
    this.refillPerMs = ratePerMinute / 60000;
    this.lastRefill = Date.now();
    this.queue = [];
    this.timer = null;
  }

  _refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  /** Resolve as many queued jobs as current tokens allow, then schedule the next check. */
  _drain() {
    this._refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const { resolve } = this.queue.shift();
      resolve();
    }
    if (this.queue.length > 0) {
      if (this.timer) clearTimeout(this.timer);
      // Wake up right when the next token should be ready.
      const msUntilNextToken = Math.max(20, (1 - this.tokens) / this.refillPerMs);
      this.timer = setTimeout(() => this._drain(), msUntilNextToken);
    }
  }

  /** Await this before making a rate-limited call. Resolves once a slot opens up. */
  acquire() {
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      this._drain();
    });
  }

  get pending() {
    return this.queue.length;
  }
}

module.exports = { TokenBucketQueue };
