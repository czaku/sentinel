/**
 * Feature Matrix
 * Produces a cross-platform × feature completeness table.
 * Detects orphan endpoints (API with no consumer) and views with no API backing.
 */
import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import chalk from 'chalk'
import type { FeatureSchema, ResolvedConfig, ValidationResult, ValidationIssue, PlatformKey } from '../config/types.js'
import { readJSON } from '../utils/file.js'

export interface MatrixRow {
  feature: string
  milestone: number
  status: string
  tier: string
  platforms: Partial<Record<PlatformKey, { status: string; hasScreens: boolean; hasEndpoints: boolean }>>
  hasChaos: boolean
}

export async function buildFeatureMatrix(config: ResolvedConfig): Promise<{ rows: MatrixRow[]; result: ValidationResult }> {
  const start = performance.now()
  const issues: ValidationIssue[] = []

  if (!fs.existsSync(config.featuresDir)) {
    return { rows: [], result: { layer: 'contracts/matrix', passed: true, issues, durationMs: 0, checkedCount: 0 } }
  }

  const featureFiles = await glob('**/*.json', { cwd: config.featuresDir, absolute: true })
  const chaosDir = path.join(config.sentinelDir, 'chaos')
  const rows: MatrixRow[] = []

  for (const file of featureFiles) {
    const feature = readJSON<FeatureSchema>(file)
    if (feature.type !== 'feature') continue

    // Check for chaos coverage
    const hasChaos = fs.existsSync(chaosDir) &&
      fs.readdirSync(chaosDir).some(f => f.includes(feature.id))

    const platformStatuses: MatrixRow['platforms'] = {}
    for (const [platform, status] of Object.entries(feature.platforms ?? {})) {
      if (!status) continue
      platformStatuses[platform as PlatformKey] = {
        status: status.status,
        hasScreens: (status.screens?.length ?? 0) > 0,
        hasEndpoints: (status.endpoints?.length ?? 0) > 0,
      }
    }

    // Detect: API endpoint with no mobile/web consumer
    const hasApi = 'api' in (feature.platforms ?? {})
    const hasConsumer = Object.keys(feature.platforms ?? {}).some(p => p !== 'api')
    if (hasApi && !hasConsumer) {
      issues.push({
        severity: 'warning',
        layer: 'contracts',
        rule: 'orphan-endpoint',
        feature: feature.id,
        message: `Feature "${feature.id}" has API endpoints but no client platform declared`,
        fix: `Add apple/google/web platform to the feature schema`,
      })
    }

    // Detect: client view with no API backing
    const declaredPlatforms = Object.keys(feature.platforms ?? {})
    const clientPlatforms = declaredPlatforms.filter(p => p !== 'api')
    if (clientPlatforms.length > 0 && !hasApi) {
      issues.push({
        severity: 'warning',
        layer: 'contracts',
        rule: 'missing-api',
        feature: feature.id,
        message: `Feature "${feature.id}" has client platforms [${clientPlatforms.join(', ')}] but no API declared`,
        fix: `Add "api" platform to the feature schema, or mark as client-only`,
      })
    }

    if (!hasChaos) {
      issues.push({
        severity: 'info',
        layer: 'contracts',
        rule: 'chaos-coverage',
        feature: feature.id,
        message: `No chaos scenario found for feature "${feature.id}"`,
        fix: `Add a chaos scenario in sentinel/chaos/${feature.id}.ts`,
      })
    }

    rows.push({
      feature: feature.id,
      milestone: feature.milestone,
      status: feature.status,
      tier: feature.tier,
      platforms: platformStatuses,
      hasChaos,
    })
  }

  rows.sort((a, b) => a.milestone - b.milestone || a.feature.localeCompare(b.feature))

  return {
    rows,
    result: {
      layer: 'contracts/matrix',
      passed: issues.filter(i => i.severity === 'error').length === 0,
      issues,
      durationMs: Math.round(performance.now() - start),
      checkedCount: rows.length,
    }
  }
}

export function printMatrix(rows: MatrixRow[], allPlatforms: PlatformKey[]): void {
  if (rows.length === 0) {
    console.log(chalk.dim('  No feature schemas found'))
    return
  }

  const col = (s: string, w: number) => s.padEnd(w).slice(0, w)
  const statusIcon = (s: string) => ({
    'shipped':     chalk.green('✓'),
    'in-progress': chalk.yellow('◐'),
    'planned':     chalk.dim('○'),
    'deprecated':  chalk.red('✗'),
  }[s] ?? chalk.dim('?'))

  const platformCols = allPlatforms.filter(p => rows.some(r => p in r.platforms))
  const header = [
    `  ${col('Feature', 28)}`,
    `M`,
    `Tier     `,
    ...platformCols.map(p => col(p, 8)),
    `Chaos`,
  ].join('  ')

  console.log(chalk.dim(header))
  console.log(chalk.dim('  ' + '─'.repeat(header.length - 2)))

  let lastMilestone = 0
  for (const row of rows) {
    if (row.milestone !== lastMilestone) {
      if (lastMilestone > 0) console.log()
      console.log(chalk.dim(`  ── Milestone ${row.milestone} ──`))
      lastMilestone = row.milestone
    }

    const platforms = platformCols.map(p => {
      const s = row.platforms[p]
      return s ? col(statusIcon(s.status) + ' ' + s.status, 8) : col(chalk.dim('—'), 8)
    })

    console.log([
      `  ${col(row.feature, 28)}`,
      String(row.milestone),
      col(row.tier, 9),
      ...platforms,
      row.hasChaos ? chalk.green('✓') : chalk.dim('—'),
    ].join('  '))
  }
}
