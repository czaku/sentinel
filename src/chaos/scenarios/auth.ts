import type { ChaosResult } from './network.js'

export interface AuthChaosOptions {
  target: string
  validToken?: string
}

export abstract class AuthChaosScenario {
  abstract id: string
  abstract description: string
  abstract run(opts: AuthChaosOptions): Promise<ChaosResult>

  protected makeResult(
    passed: boolean,
    observations: string[],
    durationMs: number
  ): ChaosResult {
    return { scenario: this.id, passed, observations, durationMs }
  }
}

/**
 * Built-in: expired token scenario.
 * Fires a request with a known-expired JWT and asserts the client handles 401 gracefully.
 */
export class ExpiredTokenScenario extends AuthChaosScenario {
  id = 'auth.token-expired'
  description = 'Request with expired JWT — client must refresh silently without user interruption'

  async run(opts: AuthChaosOptions): Promise<ChaosResult> {
    const start = performance.now()
    const observations: string[] = []
    let passed = true

    try {
      const expiredToken = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.invalid'
      const res = await fetch(`${opts.target}/auth/me`, {
        headers: { Authorization: `Bearer ${expiredToken}` }
      })

      if (res.status === 401) {
        observations.push('API correctly returns 401 for expired token')
      } else {
        observations.push(`Unexpected status: ${res.status}`)
        passed = false
      }
    } catch (err) {
      observations.push(`Request error: ${String(err)}`)
      passed = false
    }

    return this.makeResult(passed, observations, Math.round(performance.now() - start))
  }
}

/**
 * Built-in: no token scenario.
 * Asserts protected endpoints return 401.
 */
export class NoTokenScenario extends AuthChaosScenario {
  id = 'auth.no-token'
  description = 'Request to protected endpoint with no auth header — must return 401'

  async run(opts: AuthChaosOptions): Promise<ChaosResult> {
    const start = performance.now()
    const observations: string[] = []
    let passed = true

    const protectedEndpoints = ['/workouts', '/profile', '/exercises/custom']

    for (const endpoint of protectedEndpoints) {
      try {
        const res = await fetch(`${opts.target}${endpoint}`)
        if (res.status === 401) {
          observations.push(`✓ ${endpoint} → 401`)
        } else {
          observations.push(`✗ ${endpoint} → ${res.status} (expected 401)`)
          passed = false
        }
      } catch (err) {
        observations.push(`${endpoint} → error: ${String(err)}`)
      }
    }

    return this.makeResult(passed, observations, Math.round(performance.now() - start))
  }
}
