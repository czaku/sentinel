/**
 * Flows — Maestro layer
 * Discovers Maestro YAML flows in sentinel/flows/maestro/ and runs them via the maestro CLI.
 */
import { execSync, spawnSync } from 'child_process'
import path from 'path'
import { glob } from 'glob'
import chalk from 'chalk'
import type { ResolvedConfig, ValidationResult, ValidationIssue } from '../config/types.js'
import { log } from '../utils/logger.js'

export async function runMaestroFlows(config: ResolvedConfig, filter?: string): Promise<ValidationResult> {
  const start = performance.now()
  const flowsDir = path.join(config.sentinelDir, 'flows', 'maestro')
  const issues: ValidationIssue[] = []

  // Check if maestro is installed
  if (!isMaestroInstalled()) {
    log.warn('Maestro not installed — skipping mobile flow tests')
    log.warn('  Install: https://maestro.mobile.dev/getting-started/installing-maestro')
    return {
      layer: 'flows.maestro',
      passed: true,
      issues: [{
        severity: 'warning',
        layer: 'flows.maestro',
        rule: 'maestro-not-installed',
        message: 'Maestro CLI not found — mobile UI flow tests skipped',
        fix: 'Install Maestro: curl -Ls "https://get.maestro.mobile.dev" | bash',
      }],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  const allFiles = await glob('**/*.yaml', { cwd: flowsDir, absolute: true })
  const files = filter
    ? allFiles.filter(f => path.basename(f).includes(filter))
    : allFiles

  if (files.length === 0) {
    log.warn(`No Maestro flows found in ${flowsDir}`)
    return {
      layer: 'flows.maestro',
      passed: true,
      issues: [],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  log.header(`Maestro Flows (${files.length} flows)`)
  log.rule()

  let passed = 0
  let failed = 0

  for (const file of files) {
    const name = path.relative(flowsDir, file)
    process.stdout.write(`  ${chalk.dim('→')} ${name} ... `)

    const result = spawnSync('maestro', ['test', file], {
      encoding: 'utf-8',
      timeout: 120_000,
    })

    if (result.status === 0) {
      console.log(chalk.green('passed'))
      passed++
    } else {
      console.log(chalk.red('FAILED'))
      failed++
      const errorLines = (result.stderr || result.stdout || '').split('\n').slice(0, 5)
      for (const line of errorLines) {
        if (line.trim()) console.log(chalk.dim(`       ${line}`))
      }
      issues.push({
        severity: 'error',
        layer: 'flows.maestro',
        rule: 'flow-failed',
        file,
        message: `Maestro flow failed: ${name}`,
        fix: `Run manually: maestro test ${file}`,
      })
    }
  }

  return {
    layer: 'flows.maestro',
    passed: failed === 0,
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: files.length,
  }
}

function isMaestroInstalled(): boolean {
  try {
    execSync('maestro --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
