import type { ChaosResult, ChaosScenario } from '../types.js'

export abstract class AuthChaosScenario implements ChaosScenario {
  abstract id: string
  abstract description: string
  abstract run(opts: Record<string, unknown>): Promise<ChaosResult>

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
 * Fires a request with a known-expired JWT and asserts the API returns 401.
 */
export class ExpiredTokenScenario extends AuthChaosScenario {
  id = 'auth.token-expired'
  description = 'Request with expired JWT — API must return 401'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const start = performance.now()
    const observations: string[] = []
    let passed = true

    try {
      const expiredToken = 'eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjB9.invalid'
      const res = await fetch(`${target}/auth/me`, {
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
 * Asserts protected endpoints return 401 when called without auth.
 * Pass protectedEndpoints in opts, or skip gracefully when none declared.
 */
export class NoTokenScenario extends AuthChaosScenario {
  id = 'auth.no-token'
  description = 'Request to protected endpoints with no auth header — must return 401'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const start = performance.now()
    const observations: string[] = []
    let passed = true

    const endpoints = (opts.protectedEndpoints as string[] | undefined) ?? []

    if (endpoints.length === 0) {
      return this.makeResult(true, ['No protected endpoints declared — skipped'], Math.round(performance.now() - start))
    }

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${target}${endpoint}`)
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
