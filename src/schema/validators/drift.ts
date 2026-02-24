/**
 * Drift Detector
 * Checks that features declared for multiple platforms are implemented on ALL of them.
 * A feature shipped on apple but not google = drift.
 */
import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import type { FeatureSchema, ResolvedConfig, ValidationResult, ValidationIssue } from '../../config/types.js'
import { readJSON } from '../../utils/file.js'

export async function detectDrift(config: ResolvedConfig): Promise<ValidationResult> {
  const start = performance.now()
  const issues: ValidationIssue[] = []

  const featureFiles = await glob('**/*.json', { cwd: config.featuresDir, absolute: true })
  let checked = 0

  for (const file of featureFiles) {
    const feature = readJSON<FeatureSchema>(file)
    if (feature.type !== 'feature') continue
    checked++

    const declaredPlatforms = Object.keys(feature.platforms) as Array<keyof typeof feature.platforms>
    if (declaredPlatforms.length < 2) continue

    // Check screen/file existence for each platform
    for (const [platform, status] of Object.entries(feature.platforms)) {
      if (!status) continue

      // Check that declared screens actually exist in the platform directory
      const platformConfig = config.platforms[platform as keyof typeof config.platforms]
      if (!platformConfig) continue

      const platformPath = path.resolve(config.projectRoot, platformConfig.path)

      for (const screen of (status.screens ?? [])) {
        const exists = screenExists(platformPath, screen, platform)
        if (!exists) {
          issues.push({
            severity: status.status === 'shipped' ? 'error' : 'warning',
            layer: 'schema',
            rule: 'drift',
            platform: platform as any,
            feature: feature.id,
            message: `Screen "${screen}" declared in feature "${feature.id}" but file not found in ${platformConfig.path}`,
            fix: `Create the screen file or update the feature schema status to "planned"`,
          })
        }
      }
    }

    // Cross-platform parity: if shipped on one, all others should be at least in-progress
    const shipped = declaredPlatforms.filter(p => feature.platforms[p]?.status === 'shipped')
    const planned = declaredPlatforms.filter(p => feature.platforms[p]?.status === 'planned')

    if (shipped.length > 0 && planned.length > 0) {
      issues.push({
        severity: 'warning',
        layer: 'schema',
        rule: 'drift',
        feature: feature.id,
        message: `Feature "${feature.id}" is shipped on [${shipped.join(', ')}] but only planned on [${planned.join(', ')}]`,
        fix: `Implement on remaining platforms or update milestone/status`,
      })
    }
  }

  return {
    layer: 'drift',
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: checked,
  }
}

function screenExists(platformDir: string, screenName: string, platform: string): boolean {
  if (!fs.existsSync(platformDir)) return true // can't check, don't flag
  const ext = platform === 'apple' ? '.swift' : platform === 'google' ? '.kt' : '.tsx'
  // Search recursively for the screen file
  try {
    const files = walkDir(platformDir)
    return files.some(f => f.endsWith(`${screenName}${ext}`) || f.endsWith(`${screenName}View${ext}`))
  } catch {
    return true // filesystem error, don't block
  }
}

function walkDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  return entries.flatMap(e =>
    e.isDirectory()
      ? walkDir(path.join(dir, e.name))
      : [path.join(dir, e.name)]
  )
}
