/**
 * Visual — Compare
 * Compares screenshots against baselines using SHA-256 hash (fast) or pixel diff.
 * Falls back gracefully when pixel diff libraries are not installed.
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { ResolvedConfig, ValidationResult, ValidationIssue } from '../config/types.js'
import { log } from '../utils/logger.js'

export interface CompareResult {
  name: string
  platform: string
  baselinePath: string
  currentPath: string
  identical: boolean
  diffScore?: number    // 0.0–1.0 — fraction of pixels that differ (if pixel diff available)
  method: 'hash' | 'pixel'
}

export async function compareScreenshots(
  config: ResolvedConfig,
  currentDir: string
): Promise<ValidationResult> {
  const start = performance.now()
  const issues: ValidationIssue[] = []
  const baselines = path.join(config.sentinelDir, 'visual', 'baselines')

  if (!fs.existsSync(baselines)) {
    return {
      layer: 'visual',
      passed: true,
      issues: [{
        severity: 'info',
        layer: 'visual',
        rule: 'no-baselines',
        message: 'No visual baselines found — run "sentinel visual:capture" to create them',
        fix: 'sentinel visual:capture',
      }],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  const compareResults: CompareResult[] = []

  for (const platform of fs.readdirSync(baselines)) {
    const platformBaselineDir = path.join(baselines, platform)
    if (!fs.statSync(platformBaselineDir).isDirectory()) continue

    const platformCurrentDir = path.join(currentDir, platform)
    if (!fs.existsSync(platformCurrentDir)) {
      issues.push({
        severity: 'warning',
        layer: 'visual',
        rule: 'missing-current',
        platform: platform as any,
        message: `No current screenshots for platform "${platform}"`,
        fix: 'sentinel visual:capture',
      })
      continue
    }

    for (const file of fs.readdirSync(platformBaselineDir)) {
      if (!file.endsWith('.png')) continue
      const name = file.replace(/\.png$/, '')
      const baselinePath = path.join(platformBaselineDir, file)
      const currentPath = path.join(platformCurrentDir, file)

      if (!fs.existsSync(currentPath)) {
        issues.push({
          severity: 'error',
          layer: 'visual',
          rule: 'missing-screenshot',
          platform: platform as any,
          file: currentPath,
          message: `Missing current screenshot: ${platform}/${name}`,
          fix: 'sentinel visual:capture',
        })
        continue
      }

      const result = await compareImages(name, platform, baselinePath, currentPath)
      compareResults.push(result)

      if (!result.identical) {
        const diffInfo = result.diffScore !== undefined
          ? ` (${(result.diffScore * 100).toFixed(1)}% pixels differ)`
          : ''
        issues.push({
          severity: 'error',
          layer: 'visual',
          rule: 'visual-regression',
          platform: platform as any,
          file: currentPath,
          message: `Visual regression: ${platform}/${name}${diffInfo}`,
          fix: 'Review the diff, update baseline if intentional: sentinel visual:update',
        })
      }
    }
  }

  const total = compareResults.length
  const failed = compareResults.filter(r => !r.identical).length

  if (total > 0) {
    if (failed === 0) {
      log.success(`Visual: ${total} screenshots match baselines`)
    } else {
      log.error(`Visual: ${failed}/${total} screenshots differ from baselines`)
    }
  }

  return {
    layer: 'visual',
    passed: failed === 0 && !issues.some(i => i.severity === 'error'),
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: total,
  }
}

async function compareImages(
  name: string,
  platform: string,
  baselinePath: string,
  currentPath: string
): Promise<CompareResult> {
  // Try pixel-level diff with pixelmatch if available
  try {
    const pixelmatch = await import('pixelmatch').then(m => m.default).catch(() => null)
    const pngjs = await import('pngjs').then(m => m.PNG).catch(() => null)

    if (pixelmatch && pngjs) {
      const baseline = pngjs.sync.read(fs.readFileSync(baselinePath))
      const current = pngjs.sync.read(fs.readFileSync(currentPath))

      if (baseline.width !== current.width || baseline.height !== current.height) {
        return {
          name, platform,
          baselinePath, currentPath,
          identical: false,
          diffScore: 1.0,
          method: 'pixel',
        }
      }

      const totalPixels = baseline.width * baseline.height
      const diff = new pngjs({ width: baseline.width, height: baseline.height })
      const diffCount = pixelmatch(
        baseline.data, current.data, diff.data,
        baseline.width, baseline.height,
        { threshold: 0.1 }
      )

      return {
        name, platform,
        baselinePath, currentPath,
        identical: diffCount === 0,
        diffScore: diffCount / totalPixels,
        method: 'pixel',
      }
    }
  } catch { /* fall through to hash comparison */ }

  // Fallback: SHA-256 hash comparison
  const baselineHash = sha256(fs.readFileSync(baselinePath))
  const currentHash = sha256(fs.readFileSync(currentPath))

  return {
    name, platform,
    baselinePath, currentPath,
    identical: baselineHash === currentHash,
    method: 'hash',
  }
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** Update a baseline by copying the current screenshot over it */
export function updateBaseline(config: ResolvedConfig, platform: string, name: string, currentPath: string): void {
  const baselinePath = path.join(config.sentinelDir, 'visual', 'baselines', platform, `${name}.png`)
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.copyFileSync(currentPath, baselinePath)
  log.success(`Updated baseline: ${platform}/${name}`)
}
