/**
 * Chaos Runner
 * Discovers and runs chaos scenarios from the project's sentinel/chaos/ directory.
 * Projects write scenarios extending built-in primitives.
 */
import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import chalk from 'chalk'
import type { ResolvedConfig, ValidationResult } from '../config/types.js'
import type { ChaosResult } from './scenarios/network.js'
import { ExpiredTokenScenario, NoTokenScenario } from './scenarios/auth.js'
import { log } from '../utils/logger.js'

export async function runChaos(config: ResolvedConfig, filter?: string): Promise<ValidationResult> {
  const start = performance.now()
  const chaosDir = path.join(config.sentinelDir, 'chaos')
  const results: ChaosResult[] = []

  const apiTarget = config.chaos?.targets?.api ?? 'http://localhost:3000'

  // ─── Built-in scenarios ─────────────────────────────────────────────────────
  const builtIn = [
    new ExpiredTokenScenario(),
    new NoTokenScenario(),
  ]

  // ─── Project scenarios (from sentinel/chaos/*.ts) ───────────────────────────
  const projectScenarios: Array<{ id: string; description: string; run: (opts: any) => Promise<ChaosResult> }> = []

  if (fs.existsSync(chaosDir)) {
    const files = await glob('**/*.ts', { cwd: chaosDir, absolute: true })
    for (const file of files) {
      try {
        const mod = await import(file)
        const ScenarioClass = mod.default
        if (ScenarioClass && typeof ScenarioClass === 'function') {
          projectScenarios.push(new ScenarioClass())
        }
      } catch (err) {
        log.warn(`Could not load chaos scenario: ${file} — ${String(err)}`)
      }
    }
  }

  const all = [...builtIn, ...projectScenarios]
  const toRun = filter
    ? all.filter(s => s.id.includes(filter))
    : all

  if (toRun.length === 0) {
    log.warn('No chaos scenarios found. Add scenarios to sentinel/chaos/')
    return {
      layer: 'chaos',
      passed: true,
      issues: [],
      durationMs: 0,
      checkedCount: 0,
    }
  }

  log.header(`Chaos Testing (${toRun.length} scenarios)`)
  log.rule()

  for (const scenario of toRun) {
    process.stdout.write(`  ${chalk.dim('→')} ${scenario.description} ... `)
    const result = await scenario.run({ target: apiTarget })
    results.push(result)

    if (result.passed) {
      console.log(chalk.green('passed') + chalk.dim(` ${result.durationMs}ms`))
    } else {
      console.log(chalk.red('FAILED') + chalk.dim(` ${result.durationMs}ms`))
      for (const obs of result.observations) {
        console.log(chalk.dim(`       ${obs}`))
      }
    }
  }

  const failed = results.filter(r => !r.passed)

  return {
    layer: 'chaos',
    passed: failed.length === 0,
    issues: failed.map(r => ({
      severity: 'error' as const,
      layer: 'chaos',
      rule: r.scenario,
      message: `Chaos scenario failed: ${r.scenario}`,
      fix: `Check observations above and fix the failing behaviour`,
    })),
    durationMs: Math.round(performance.now() - start),
    checkedCount: results.length,
  }
}
