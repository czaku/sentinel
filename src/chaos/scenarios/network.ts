/**
 * Network chaos primitives.
 * Projects extend these to write their own scenarios.
 */
import type { ChaosResult, ChaosScenario } from '../types.js'

export type { ChaosResult, ChaosScenario }  // re-export for backwards compat

export interface NetworkChaosOptions {
  /** API base URL to target */
  target: string
  /** Duration in ms to sustain the chaos condition */
  durationMs?: number
}

/**
 * Base class for project-specific chaos scenarios.
 * Extend this in your sentinel/chaos/ files.
 *
 * @example
 * // sentinel/chaos/workout-offline.ts
 * import { NetworkChaosScenario } from 'sentinel/chaos/scenarios/network'
 *
 * export default class WorkoutOfflineScenario extends NetworkChaosScenario {
 *   id = 'workout-offline'
 *   description = 'Active workout in progress — network drops — must save locally, no data loss'
 *
 *   async run(opts) {
 *     const result = await super.simulateOffline(opts, async () => {
 *       // Your test logic here — assert that local save works
 *     })
 *     return result
 *   }
 * }
 */
export abstract class NetworkChaosScenario implements ChaosScenario {
  abstract id: string
  abstract description: string
  abstract run(opts: Record<string, unknown>): Promise<ChaosResult>

  protected async simulateOffline(
    opts: NetworkChaosOptions,
    test: () => Promise<{ passed: boolean; observations: string[] }>
  ): Promise<ChaosResult> {
    const start = performance.now()
    // In a real implementation this would proxy network calls to simulate failure.
    // For now, tests verify behaviour by calling the test function.
    const { passed, observations } = await test()
    return { scenario: this.id, passed, observations, durationMs: Math.round(performance.now() - start) }
  }

  protected async simulateSlow(
    opts: NetworkChaosOptions,
    latencyMs: number,
    test: () => Promise<{ passed: boolean; observations: string[] }>
  ): Promise<ChaosResult> {
    const start = performance.now()
    await delay(latencyMs)
    const { passed, observations } = await test()
    return { scenario: this.id, passed, observations, durationMs: Math.round(performance.now() - start) }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
