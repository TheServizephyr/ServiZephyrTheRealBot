/**
 * Circuit Breaker for External Services
 *
 * Prevents cascading failures when WhatsApp API, Razorpay, or PhonePe
 * are down or degraded. Three states:
 *   CLOSED  → normal operation, requests pass through
 *   OPEN    → service is down, requests fail-fast without calling the service
 *   HALF_OPEN → after timeout, allow ONE probe request to test recovery
 *
 * Usage:
 *   const result = await whatsappBreaker.call(() => sendWhatsAppMessage(...));
 *   if (!result.ok) console.warn('WhatsApp unavailable:', result.error);
 */

const STATE = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

class CircuitBreaker {
  /**
   * @param {string} name - Human-readable service name for logging
   * @param {object} opts
   * @param {number} opts.failureThreshold - Failures before opening (default 5)
   * @param {number} opts.resetTimeoutMs - How long to stay open before half-open probe (default 30s)
   * @param {number} opts.callTimeoutMs - Max time to wait for the wrapped call (default 10s)
   */
  constructor(name, {
    failureThreshold = 5,
    resetTimeoutMs = 30_000,
    callTimeoutMs = 10_000,
  } = {}) {
    this.name = name;
    this.failureThreshold = Math.max(1, failureThreshold);
    this.resetTimeoutMs = Math.max(5_000, resetTimeoutMs);
    this.callTimeoutMs = Math.max(1_000, callTimeoutMs);
    this.state = STATE.CLOSED;
    this.failures = 0;
    this.lastFailureAt = 0;
    this.successesSinceHalfOpen = 0;
  }

  /** Current state snapshot for monitoring */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
    };
  }

  /**
   * Execute a function through the circuit breaker.
   * @param {Function} fn - Async function to call
   * @returns {Promise<{ok: boolean, data?: any, error?: string, circuitOpen?: boolean}>}
   */
  async call(fn) {
    // OPEN → check if timeout has elapsed for half-open probe
    if (this.state === STATE.OPEN) {
      const elapsed = Date.now() - this.lastFailureAt;
      if (elapsed < this.resetTimeoutMs) {
        return {
          ok: false,
          error: `[CircuitBreaker:${this.name}] OPEN — failing fast (retry in ${Math.ceil((this.resetTimeoutMs - elapsed) / 1000)}s)`,
          circuitOpen: true,
        };
      }
      // Transition to HALF_OPEN for a probe
      this.state = STATE.HALF_OPEN;
      this.successesSinceHalfOpen = 0;
      console.log(`[CircuitBreaker:${this.name}] HALF_OPEN — allowing probe request`);
    }

    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`[CircuitBreaker:${this.name}] Call timed out after ${this.callTimeoutMs}ms`)), this.callTimeoutMs)
        ),
      ]);

      this._onSuccess();
      return { ok: true, data: result };
    } catch (error) {
      this._onFailure(error);
      return {
        ok: false,
        error: error?.message || String(error),
        circuitOpen: false,
      };
    }
  }

  _onSuccess() {
    if (this.state === STATE.HALF_OPEN) {
      this.successesSinceHalfOpen += 1;
      // Require 2 consecutive successes in half-open to fully close
      if (this.successesSinceHalfOpen >= 2) {
        console.log(`[CircuitBreaker:${this.name}] CLOSED — service recovered`);
        this.state = STATE.CLOSED;
        this.failures = 0;
      }
    } else {
      this.failures = Math.max(0, this.failures - 1); // decay on success
    }
  }

  _onFailure(error) {
    this.failures += 1;
    this.lastFailureAt = Date.now();

    if (this.state === STATE.HALF_OPEN) {
      console.warn(`[CircuitBreaker:${this.name}] OPEN — probe failed:`, error?.message || error);
      this.state = STATE.OPEN;
      return;
    }

    if (this.failures >= this.failureThreshold) {
      console.warn(`[CircuitBreaker:${this.name}] OPEN — ${this.failures} consecutive failures`);
      this.state = STATE.OPEN;
    }
  }
}

// ============================================
// PRE-CONFIGURED BREAKERS
// ============================================

/** WhatsApp Meta Graph API — rate limited at Meta's end, can have outages */
export const whatsappBreaker = new CircuitBreaker('WhatsApp', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  callTimeoutMs: 10_000,
});

/** Razorpay payment gateway */
export const razorpayBreaker = new CircuitBreaker('Razorpay', {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 15_000,
});

/** PhonePe payment gateway */
export const phonePeBreaker = new CircuitBreaker('PhonePe', {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  callTimeoutMs: 15_000,
});

/** Get monitoring payload for all breakers */
export function getAllCircuitBreakerStatuses() {
  return [
    whatsappBreaker.getStatus(),
    razorpayBreaker.getStatus(),
    phonePeBreaker.getStatus(),
  ];
}

export default CircuitBreaker;
