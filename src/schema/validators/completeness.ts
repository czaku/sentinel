/**
 * Completeness Checker
 * Ensures every feature schema has all required sections,
 * and that required design/platform schema files exist.
 */
import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import type { FeatureSchema, ResolvedConfig, ValidationResult, ValidationIssue } from '../../config/types.js'
import { readJSON } from '../../utils/file.js'

export async function checkCompleteness(config: ResolvedConfig): Promise<ValidationResult> {
  const start = performance.now()
  const issues: ValidationIssue[] = []

  // ─── Required schema files ─────────────────────────────────────────────────
  const required = [
    { file: path.join(config.designDir, 'tokens.json'),              label: 'design/tokens.json' },
    { file: path.join(config.designDir, 'strings.json'),             label: 'design/strings.json' },
    { file: path.join(config.platformDir, 'feature-flags.json'),     label: 'platform/feature-flags.json' },
    { file: path.join(config.platformDir, 'navigation.json'),        label: 'platform/navigation.json' },
  ]

  for (const { file, label } of required) {
    if (!fs.existsSync(file)) {
      issues.push({
        severity: 'error',
        layer: 'schema',
        rule: 'completeness',
        file,
        message: `Required schema missing: sentinel/schemas/${label}`,
        fix: `Create the file — see sentinel schema format docs`,
      })
    }
  }

  // ─── Feature schema completeness ───────────────────────────────────────────
  if (!fs.existsSync(config.featuresDir)) {
    issues.push({
      severity: 'warning',
      layer: 'schema',
      rule: 'completeness',
      message: `No features directory found at sentinel/schemas/features/`,
      fix: `Create at least one feature schema`,
    })
    return result(issues, start, 0)
  }

  const featureFiles = await glob('**/*.json', { cwd: config.featuresDir, absolute: true })
  let checked = 0

  for (const file of featureFiles) {
    const feature = readJSON<FeatureSchema>(file)
    checked++

    if (feature.type !== 'feature') {
      issues.push({
        severity: 'error',
        layer: 'schema',
        rule: 'completeness',
        file,
        message: `Schema missing required field: type: "feature"`,
        fix: `Add "type": "feature" to the schema`,
      })
      continue
    }

    const requiredFields: Array<keyof FeatureSchema> = ['id', 'name', 'milestone', 'status', 'tier', 'platforms']
    for (const field of requiredFields) {
      if (feature[field] === undefined || feature[field] === null) {
        issues.push({
          severity: 'error',
          layer: 'schema',
          rule: 'completeness',
          feature: feature.id ?? path.basename(file),
          file,
          message: `Feature schema missing required field: "${field}"`,
        })
      }
    }

    // Every declared platform must have a status
    for (const [platform, status] of Object.entries(feature.platforms ?? {})) {
      if (!status?.status) {
        issues.push({
          severity: 'error',
          layer: 'schema',
          rule: 'completeness',
          feature: feature.id,
          platform: platform as any,
          file,
          message: `Platform "${platform}" declared but missing "status" field`,
        })
      }
    }
  }

  return result(issues, start, checked + required.length)
}

function result(issues: ValidationIssue[], start: number, checked: number): ValidationResult {
  return {
    layer: 'completeness',
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: checked,
  }
}
