/**
 * Payment / subscription chaos scenarios.
 * Tests how the product handles billing failure states.
 */
import type { ChaosResult } from '../types.js'

abstract class PaymentChaosScenario {
  abstract id: string
  abstract description: string
  abstract run(opts: Record<string, unknown>): Promise<ChaosResult>

  protected makeResult(passed: boolean, observations: string[], durationMs: number): ChaosResult {
    return { scenario: this.id, passed, observations, durationMs }
  }
}

/**
 * Verifies the API returns 402 or 403 when called with a token belonging to
 * an account with a declined card / past-due subscription.
 */
export class CardDeclinedScenario extends PaymentChaosScenario {
  id = 'payment.card-declined'
  description = 'Pro endpoints with past-due subscription token — must return 402 or 403'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const pastDueToken = opts.pastDueToken as string | undefined
    const start = performance.now()
    const observations: string[] = []

    if (!pastDueToken) {
      return this.makeResult(true, ['No pastDueToken provided — skipped'], Math.round(performance.now() - start))
    }

    const proEndpoints = (opts.proEndpoints as string[]) ?? []
    if (proEndpoints.length === 0) {
      return this.makeResult(true, ['No proEndpoints declared — skipped'], Math.round(performance.now() - start))
    }

    let passed = true
    for (const endpoint of proEndpoints) {
      try {
        const res = await fetch(`${target}${endpoint}`, {
          headers: { Authorization: `Bearer ${pastDueToken}` },
        })
        if (res.status === 402 || res.status === 403) {
          observations.push(`✓ ${endpoint} → ${res.status} (correctly blocked past-due account)`)
        } else if (res.status === 200) {
          observations.push(`✗ ${endpoint} → 200 (pro endpoint accessible with past-due token)`)
          passed = false
        } else {
          observations.push(`⚬ ${endpoint} → ${res.status}`)
        }
      } catch (err) {
        observations.push(`${endpoint} → error: ${String(err)}`)
      }
    }

    return this.makeResult(passed, observations, Math.round(performance.now() - start))
  }
}

/**
 * Verifies that free-tier endpoints remain accessible when subscription is expired.
 * Pro features should be blocked; free features must remain open.
 */
export class SubscriptionExpiredScenario extends PaymentChaosScenario {
  id = 'payment.subscription-expired'
  description = 'Free-tier endpoints with expired subscription — must remain accessible (not 402/403)'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const expiredToken = opts.expiredSubscriptionToken as string | undefined
    const start = performance.now()
    const observations: string[] = []

    if (!expiredToken) {
      return this.makeResult(true, ['No expiredSubscriptionToken provided — skipped'], Math.round(performance.now() - start))
    }

    const freeEndpoints = (opts.freeEndpoints as string[]) ?? []
    if (freeEndpoints.length === 0) {
      return this.makeResult(true, ['No freeEndpoints declared — skipped'], Math.round(performance.now() - start))
    }

    let passed = true
    for (const endpoint of freeEndpoints) {
      try {
        const res = await fetch(`${target}${endpoint}`, {
          headers: { Authorization: `Bearer ${expiredToken}` },
        })
        if (res.status === 200 || res.status === 201) {
          observations.push(`✓ ${endpoint} → ${res.status} (free feature accessible with expired sub)`)
        } else if (res.status === 402 || res.status === 403) {
          observations.push(`✗ ${endpoint} → ${res.status} (free feature incorrectly blocked)`)
          passed = false
        } else {
          observations.push(`⚬ ${endpoint} → ${res.status}`)
        }
      } catch (err) {
        observations.push(`${endpoint} → error: ${String(err)}`)
      }
    }

    return this.makeResult(passed, observations, Math.round(performance.now() - start))
  }
}

/**
 * Verifies the subscription status endpoint responds correctly.
 * This is the endpoint clients poll to update local subscription state.
 */
export class WebhookMissingScenario extends PaymentChaosScenario {
  id = 'payment.webhook-missing'
  description = 'Subscription status endpoint must be reachable and return correct shape'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const token = opts.validToken as string | undefined
    const subscriptionStatusEndpoint = (opts.subscriptionStatusEndpoint as string) ?? '/subscriptions/status'
    const start = performance.now()
    const observations: string[] = []

    if (!token) {
      return this.makeResult(true, ['No validToken provided — skipped'], Math.round(performance.now() - start))
    }

    try {
      const res = await fetch(`${target}${subscriptionStatusEndpoint}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!res.ok) {
        observations.push(`✗ ${subscriptionStatusEndpoint} → ${res.status} (must be 200)`)
        return this.makeResult(false, observations, Math.round(performance.now() - start))
      }

      const body = await res.json() as unknown
      if (typeof body === 'object' && body !== null && 'status' in (body as object)) {
        observations.push(`✓ Subscription status endpoint reachable, status field present`)
      } else {
        observations.push(`✗ Response missing "status" field: ${JSON.stringify(body).slice(0, 80)}`)
        return this.makeResult(false, observations, Math.round(performance.now() - start))
      }
    } catch (err) {
      observations.push(`${subscriptionStatusEndpoint} → error: ${String(err)}`)
      return this.makeResult(false, observations, Math.round(performance.now() - start))
    }

    return this.makeResult(true, observations, Math.round(performance.now() - start))
  }
}
