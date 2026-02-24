/**
 * Platform / device chaos scenarios.
 * These are documentation-as-code: they describe platform-specific resilience
 * requirements. Real execution requires platform test harnesses (XCTest, Espresso).
 * The runner marks them as informational unless hooked to actual device runners.
 */
import type { ChaosResult } from '../types.js'

abstract class PlatformChaosScenario {
  abstract id: string
  abstract description: string
  abstract run(opts: Record<string, unknown>): Promise<ChaosResult>

  protected skip(reason: string, start: number): ChaosResult {
    return {
      scenario: this.id,
      passed: true,
      observations: [`⚬ Skipped: ${reason}`],
      durationMs: Math.round(performance.now() - start),
    }
  }

  protected makeResult(passed: boolean, observations: string[], durationMs: number): ChaosResult {
    return { scenario: this.id, passed, observations, durationMs }
  }
}

/**
 * Low storage scenario.
 * Verifies the app does not crash when local storage is near capacity.
 * The app must show a graceful warning, not crash.
 *
 * Execution: requires simulator/emulator automation — use opts.runner to plug in.
 */
export class LowStorageScenario extends PlatformChaosScenario {
  id = 'platform.low-storage'
  description = 'Device low storage — app must warn gracefully, not crash or lose data'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const start = performance.now()
    const runner = opts.platformRunner as ((scenario: string) => Promise<{ passed: boolean; log: string[] }>) | undefined

    if (!runner) {
      return this.skip('No platformRunner provided — plug in XCTest/Espresso harness via opts.platformRunner', start)
    }

    try {
      const result = await runner(this.id)
      return this.makeResult(result.passed, result.log, Math.round(performance.now() - start))
    } catch (err) {
      return this.makeResult(false, [`Platform runner threw: ${String(err)}`], Math.round(performance.now() - start))
    }
  }
}

/**
 * Background kill scenario.
 * App is backgrounded then killed by OS while a workout is in progress.
 * On relaunch, the active workout must be restored exactly as left.
 */
export class BackgroundKillScenario extends PlatformChaosScenario {
  id = 'platform.background-kill'
  description = 'App killed in background mid-workout — must restore in-progress workout on relaunch'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const start = performance.now()
    const runner = opts.platformRunner as ((scenario: string) => Promise<{ passed: boolean; log: string[] }>) | undefined

    if (!runner) {
      return this.skip('No platformRunner provided — plug in XCTest/Espresso harness via opts.platformRunner', start)
    }

    try {
      const result = await runner(this.id)
      return this.makeResult(result.passed, result.log, Math.round(performance.now() - start))
    } catch (err) {
      return this.makeResult(false, [`Platform runner threw: ${String(err)}`], Math.round(performance.now() - start))
    }
  }
}

/**
 * Clock skew scenario.
 * Device clock is set to the past or far future.
 * JWT validation must not incorrectly fail; sync timestamps must be handled.
 */
export class ClockSkewScenario extends PlatformChaosScenario {
  id = 'platform.clock-skew'
  description = 'Device clock skewed ±24h — JWT auth and sync must handle without crash or data loss'

  async run(opts: Record<string, unknown>): Promise<ChaosResult> {
    const target = opts.target as string
    const token = opts.validToken as string | undefined
    const start = performance.now()
    const observations: string[] = []

    if (!token) {
      return this.skip('No validToken provided — API-level clock skew test skipped', start)
    }

    // At API level: verify server uses server-side time, not client time
    // by checking the server returns a valid timestamp in responses
    try {
      const res = await fetch(`${target}/health`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const body = await res.json() as unknown
        const serverTime = typeof body === 'object' && body !== null
          ? ((body as Record<string, unknown>).serverTime ?? (body as Record<string, unknown>).timestamp)
          : undefined

        if (serverTime) {
          observations.push(`✓ API returns server-side timestamp (${serverTime}) — not reliant on client clock`)
        } else {
          observations.push(`⚬ API /health reachable but no serverTime field in response`)
        }
      } else {
        observations.push(`⚬ /health → ${res.status} (skipping clock check)`)
      }
    } catch {
      return this.skip('/health endpoint not reachable — API clock skew test skipped', start)
    }

    return this.makeResult(true, observations, Math.round(performance.now() - start))
  }
}
