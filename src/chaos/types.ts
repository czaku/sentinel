// ─── Shared Chaos Types ───────────────────────────────────────────────────────

export interface ChaosResult {
  scenario: string
  passed: boolean
  observations: string[]
  durationMs: number
}

export interface ChaosScenario {
  id: string
  description: string
  run(opts: Record<string, unknown>): Promise<ChaosResult>
}
