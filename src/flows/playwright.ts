/**
 * Flows — Playwright layer
 * Runs Playwright test specs from sentinel/flows/playwright/ via the local playwright installation.
 */
import { execSync, spawnSync } from 'child_process'
import path from 'path'
import { glob } from 'glob'
import chalk from 'chalk'
import type { ResolvedConfig, ValidationResult, ValidationIssue } from '../config/types.js'
import { log } from '../utils/logger.js'

export async function runPlaywrightFlows(config: ResolvedConfig, filter?: string): Promise<ValidationResult> {
  const start = performance.now()
  const flowsDir = path.join(config.sentinelDir, 'flows', 'playwright')
  const issues: ValidationIssue[] = []

  if (!isPlaywrightInstalled(config.projectRoot)) {
    log.warn('Playwright not installed — skipping web/e2e flow tests')
    return {
      layer: 'flows.playwright',
      passed: true,
      issues: [{
        severity: 'warning',
        layer: 'flows.playwright',
        rule: 'playwright-not-installed',
        message: 'Playwright not found in project — web flow tests skipped',
        fix: 'Install: npm install -D @playwright/test && npx playwright install',
      }],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  const allFiles = await glob('**/*.spec.ts', { cwd: flowsDir, absolute: true })
  const files = filter
    ? allFiles.filter(f => path.basename(f).includes(filter))
    : allFiles

  if (files.length === 0) {
    log.warn(`No Playwright specs found in ${flowsDir}`)
    return {
      layer: 'flows.playwright',
      passed: true,
      issues: [],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  log.header(`Playwright Flows (${files.length} specs)`)
  log.rule()

  // Run all specs in one playwright invocation for speed
  const grepPattern = filter ? `--grep "${filter}"` : ''
  const result = spawnSync(
    'npx',
    ['playwright', 'test', ...files, ...(filter ? ['--grep', filter] : [])],
    {
      cwd: config.projectRoot,
      encoding: 'utf-8',
      timeout: 300_000,
    }
  )

  // Parse output for pass/fail counts
  const output = result.stdout + result.stderr
  const passMatch = output.match(/(\d+) passed/)
  const failMatch = output.match(/(\d+) failed/)
  const passedCount = passMatch ? parseInt(passMatch[1]) : 0
  const failedCount = failMatch ? parseInt(failMatch[1]) : 0

  if (result.status === 0) {
    console.log(chalk.green(`  ✓ ${passedCount} specs passed`))
  } else {
    console.log(chalk.red(`  ✗ ${failedCount} specs failed, ${passedCount} passed`))
    // Print last 20 lines of output
    const lines = output.split('\n').filter(l => l.trim())
    const tail = lines.slice(Math.max(0, lines.length - 20))
    for (const line of tail) {
      console.log(chalk.dim(`    ${line}`))
    }
    issues.push({
      severity: 'error',
      layer: 'flows.playwright',
      rule: 'playwright-failed',
      message: `Playwright: ${failedCount} spec(s) failed`,
      fix: `Run manually: npx playwright test ${flowsDir}`,
    })
  }

  return {
    layer: 'flows.playwright',
    passed: result.status === 0,
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: files.length,
  }
}

function isPlaywrightInstalled(projectRoot: string): boolean {
  try {
    execSync('npx playwright --version', { cwd: projectRoot, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
