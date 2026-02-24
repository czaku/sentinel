/**
 * Data chaos scenarios.
 * Tests how the API handles malformed, empty, and oversized payloads.
 */
import type { ChaosResult } from '../types.js'

abstract class DataChaosScenario {
  abstract id: string
  abstract description: string
  abstract run(opts: Record<string, unknown>): Promise<ChaosResult>

  protected makeResult(passed: boolean, observations: string[], durationMs: number): ChaosResult {
    return { scenario: this.id, passed, observations, durationMs }
  }
}

/**
 * Sends a deliberately malformed JSON body to POST endpoints.
 * API must return 400 (not 500).
 */
export class CorruptJsonScenario extends DataChaosScenario {
  id = 'data.corrupt-json'
  description = 'POST with malformed JSON body — API must return 400 not 500'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const start = performance.now()
    const observations: string[] = []
    let passed = true

    // Common write endpoints to probe
    const endpoints = (opts.writeEndpoints as string[]) ?? ['/workouts', '/exercises']

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${target}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{ "bad": json ,,, }',   // intentionally invalid
        })
        if (res.status === 400) {
          observations.push(`✓ ${endpoint} → 400 (correctly rejected malformed JSON)`)
        } else if (res.status === 401 || res.status === 403) {
          observations.push(`⚬ ${endpoint} → ${res.status} (auth required — skipped)`)
        } else if (res.status >= 500) {
          observations.push(`✗ ${endpoint} → ${res.status} (server crashed on bad JSON)`)
          passed = false
        } else {
          observations.push(`⚠ ${endpoint} → ${res.status} (unexpected — may be OK)`)
        }
      } catch (err) {
        observations.push(`${endpoint} → request error: ${String(err)}`)
      }
    }

    return this.makeResult(passed, observations, Math.round(performance.now() - start))
  }
}

/**
 * Verifies the API returns empty collections (not null/undefined) for list endpoints.
 */
export class EmptyCollectionScenario extends DataChaosScenario {
  id = 'data.empty-collection'
  description = 'New account list endpoints must return [] not null'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const token = opts.validToken as string | undefined
    const start = performance.now()
    const observations: string[] = []
    let passed = true

    if (!token) {
      return this.makeResult(true, ['No validToken provided — skipped'], Math.round(performance.now() - start))
    }

    const listEndpoints = (opts.listEndpoints as string[]) ?? ['/workouts', '/exercises']

    for (const endpoint of listEndpoints) {
      try {
        const res = await fetch(`${target}${endpoint}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          observations.push(`⚬ ${endpoint} → ${res.status} (skipped)`)
          continue
        }
        const body = await res.json() as unknown
        if (Array.isArray(body)) {
          observations.push(`✓ ${endpoint} → array (${(body as unknown[]).length} items)`)
        } else if (body !== null && typeof body === 'object' && 'data' in (body as object)) {
          const data = (body as { data: unknown }).data
          if (Array.isArray(data)) {
            observations.push(`✓ ${endpoint} → { data: [] } shape (${(data as unknown[]).length} items)`)
          } else {
            observations.push(`✗ ${endpoint} → data field is not an array: ${JSON.stringify(data)}`)
            passed = false
          }
        } else if (body === null) {
          observations.push(`✗ ${endpoint} → returned null (must be empty array)`)
          passed = false
        } else {
          observations.push(`⚠ ${endpoint} → unexpected shape: ${JSON.stringify(body).slice(0, 80)}`)
        }
      } catch (err) {
        observations.push(`${endpoint} → error: ${String(err)}`)
      }
    }

    return this.makeResult(passed, observations, Math.round(performance.now() - start))
  }
}

/**
 * Sends an oversized payload and asserts the API rejects it gracefully (413 or 400).
 */
export class LargePayloadScenario extends DataChaosScenario {
  id = 'data.large-payload'
  description = 'POST with oversized payload — API must return 413 or 400 not crash'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const start = performance.now()
    const observations: string[] = []
    let passed = true

    // Generate ~2MB of junk data
    const largeString = 'x'.repeat(2 * 1024 * 1024)
    const endpoints = (opts.writeEndpoints as string[]) ?? ['/workouts']

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${target}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: largeString }),
        })
        if (res.status === 413 || res.status === 400) {
          observations.push(`✓ ${endpoint} → ${res.status} (large payload correctly rejected)`)
        } else if (res.status === 401 || res.status === 403) {
          observations.push(`⚬ ${endpoint} → ${res.status} (auth required — skipped)`)
        } else if (res.status >= 500) {
          observations.push(`✗ ${endpoint} → ${res.status} (server crashed on large payload)`)
          passed = false
        } else {
          observations.push(`⚠ ${endpoint} → ${res.status} (accepted large payload — review limits)`)
        }
      } catch (err) {
        observations.push(`${endpoint} → request error: ${String(err)}`)
      }
    }

    return this.makeResult(passed, observations, Math.round(performance.now() - start))
  }
}
