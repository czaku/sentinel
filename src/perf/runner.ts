/**
 * Performance Runner
 * Reads sentinel/perf/budgets.yaml, hits API endpoints, measures p50/p95,
 * and fails if any budget is exceeded.
 */
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import chalk from 'chalk'
import type { ResolvedConfig, ValidationResult, ValidationIssue } from '../config/types.js'
import { log } from '../utils/logger.js'

interface BudgetEntry {
  endpoint: string
  method?: string
  maxMs: number
  category?: 'critical' | 'standard' | 'background'
  body?: Record<string, unknown>
}

interface BudgetsFile {
  version: string
  config?: {
    warmup?: number
    samples?: number
    timeout?: number
  }
  auth?: {
    type: 'bearer'
    tokenEnv: string
  }
  budgets: BudgetEntry[]
}

interface Measurement {
  endpoint: string
  method: string
  samples: number[]
  p50: number
  p95: number
  maxMs: number
  passed: boolean
}

export async function runPerf(config: ResolvedConfig, filter?: string): Promise<ValidationResult> {
  const start = performance.now()
  const issues: ValidationIssue[] = []

  const budgetsPath = path.join(config.sentinelDir, 'perf', 'budgets.yaml')
  if (!fs.existsSync(budgetsPath)) {
    log.warn('No perf/budgets.yaml found — performance checks skipped')
    return {
      layer: 'perf',
      passed: true,
      issues: [{
        severity: 'info',
        layer: 'perf',
        rule: 'no-budgets',
        message: 'No perf/budgets.yaml found — create one to enable API performance budgets',
        fix: `Create sentinel/perf/budgets.yaml`,
      }],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  const budgetsFile = yaml.load(fs.readFileSync(budgetsPath, 'utf-8')) as BudgetsFile
  const apiTarget = config.chaos?.targets?.api ?? 'http://localhost:3000'

  const { warmup = 2, samples = 5, timeout = 10_000 } = budgetsFile.config ?? {}

  // Resolve auth token
  let authToken: string | undefined
  if (budgetsFile.auth?.type === 'bearer') {
    authToken = process.env[budgetsFile.auth.tokenEnv]
    if (!authToken) {
      log.warn(`Perf: ${budgetsFile.auth.tokenEnv} env var not set — unauthenticated requests`)
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const budgets = filter
    ? budgetsFile.budgets.filter(b => b.endpoint.includes(filter))
    : budgetsFile.budgets

  if (budgets.length === 0) {
    log.warn('No matching perf budgets found')
    return {
      layer: 'perf',
      passed: true,
      issues: [],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  log.header(`Performance Budgets (${budgets.length} endpoints)`)
  log.rule()
  console.log(chalk.dim(`  Target: ${apiTarget} | Samples: ${samples} | Warmup: ${warmup}`))
  console.log()

  const measurements: Measurement[] = []

  for (const budget of budgets) {
    const method = (budget.method ?? 'GET').toUpperCase()
    const url = `${apiTarget}${budget.endpoint}`
    const category = budget.category ?? 'standard'
    const label = `${method} ${budget.endpoint}`

    process.stdout.write(`  ${chalk.dim('→')} ${label} `)

    // Warmup rounds (discarded)
    for (let i = 0; i < warmup; i++) {
      try {
        await fetch(url, {
          method,
          headers,
          body: budget.body ? JSON.stringify(budget.body) : undefined,
          signal: AbortSignal.timeout(timeout),
        })
      } catch { /* ignore warmup errors */ }
    }

    // Measured rounds
    const times: number[] = []
    for (let i = 0; i < samples; i++) {
      const t0 = performance.now()
      try {
        await fetch(url, {
          method,
          headers,
          body: budget.body ? JSON.stringify(budget.body) : undefined,
          signal: AbortSignal.timeout(timeout),
        })
      } catch {
        // Network error counts as timeout
        times.push(timeout)
        continue
      }
      times.push(Math.round(performance.now() - t0))
    }

    times.sort((a, b) => a - b)
    const p50 = times[Math.floor(times.length * 0.5)]
    const p95 = times[Math.floor(times.length * 0.95)]

    const passed = p95 <= budget.maxMs
    const measurement: Measurement = {
      endpoint: budget.endpoint,
      method,
      samples: times,
      p50,
      p95,
      maxMs: budget.maxMs,
      passed,
    }
    measurements.push(measurement)

    const p50str = chalk.dim(`p50:${p50}ms`)
    const p95str = p95 > budget.maxMs
      ? chalk.red(`p95:${p95}ms`)
      : chalk.green(`p95:${p95}ms`)
    const budgetStr = chalk.dim(`budget:${budget.maxMs}ms`)
    const badge = passed ? chalk.green(`✓ [${category}]`) : chalk.red(`✗ [${category}]`)

    console.log(`${badge} ${p50str} ${p95str} ${budgetStr}`)

    if (!passed) {
      issues.push({
        severity: 'error',
        layer: 'perf',
        rule: 'budget-exceeded',
        message: `${label} p95 ${p95}ms exceeds budget ${budget.maxMs}ms`,
        fix: `Optimise the endpoint or raise the budget in sentinel/perf/budgets.yaml`,
      })
    }
  }

  const failedCount = measurements.filter(m => !m.passed).length
  console.log()
  if (failedCount === 0) {
    log.success(`All ${measurements.length} endpoints within budget`)
  } else {
    log.error(`${failedCount}/${measurements.length} endpoints exceeded budget`)
  }

  return {
    layer: 'perf',
    passed: failedCount === 0,
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: budgets.length,
  }
}
