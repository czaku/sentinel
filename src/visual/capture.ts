/**
 * Visual — Capture
 * Coordinates screenshot capture via Maestro (mobile) or Playwright (web).
 * Screenshots are saved to sentinel/visual/baselines/<platform>/<name>.png
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import chalk from 'chalk'
import type { ResolvedConfig } from '../config/types.js'
import { log } from '../utils/logger.js'

export interface CaptureTarget {
  name: string
  platform: 'apple' | 'google' | 'web'
  flowFile?: string    // Maestro YAML or Playwright spec
  url?: string         // for web direct capture
}

export interface CaptureResult {
  name: string
  platform: string
  screenshotPath: string
  success: boolean
  error?: string
}

export async function captureScreenshots(
  config: ResolvedConfig,
  targets: CaptureTarget[]
): Promise<CaptureResult[]> {
  const baselines = path.join(config.sentinelDir, 'visual', 'baselines')
  const results: CaptureResult[] = []

  for (const target of targets) {
    const platformDir = path.join(baselines, target.platform)
    fs.mkdirSync(platformDir, { recursive: true })

    const screenshotPath = path.join(platformDir, `${target.name}.png`)

    log.dim(`  Capturing ${target.platform}/${target.name}...`)

    if (target.platform === 'web' && target.url) {
      const result = await captureWebScreenshot(target.url, screenshotPath, config.projectRoot)
      results.push({ ...result, name: target.name, platform: target.platform })
    } else if ((target.platform === 'apple' || target.platform === 'google') && target.flowFile) {
      const result = captureMobileScreenshot(target.flowFile, screenshotPath)
      results.push({ ...result, name: target.name, platform: target.platform })
    } else {
      results.push({
        name: target.name,
        platform: target.platform,
        screenshotPath,
        success: false,
        error: 'No flowFile or url provided for capture',
      })
    }
  }

  return results
}

async function captureWebScreenshot(
  url: string,
  outputPath: string,
  projectRoot: string
): Promise<Omit<CaptureResult, 'name' | 'platform'>> {
  // Use playwright to capture a screenshot
  const script = `
const { chromium } = require('@playwright/test')
;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto('${url}', { waitUntil: 'networkidle' })
  await page.screenshot({ path: '${outputPath}', fullPage: false })
  await browser.close()
})()
`
  const tmpScript = path.join(projectRoot, '.sentinel-capture-tmp.cjs')
  fs.writeFileSync(tmpScript, script)

  const result = spawnSync('node', [tmpScript], { encoding: 'utf-8', timeout: 30_000, cwd: projectRoot })
  fs.unlinkSync(tmpScript)

  if (result.status !== 0) {
    return { screenshotPath: outputPath, success: false, error: result.stderr.slice(0, 200) }
  }
  return { screenshotPath: outputPath, success: true }
}

function captureMobileScreenshot(
  flowFile: string,
  outputPath: string
): Omit<CaptureResult, 'name' | 'platform'> {
  // Maestro supports --screenshot flag (or --format=junit with screenshots)
  // For now: run the flow, maestro saves screenshots to a known dir
  const result = spawnSync(
    'maestro',
    ['test', flowFile, '--screenshot', outputPath],
    { encoding: 'utf-8', timeout: 120_000 }
  )

  if (result.status !== 0) {
    return { screenshotPath: outputPath, success: false, error: result.stderr.slice(0, 200) }
  }
  return { screenshotPath: outputPath, success: true }
}

export function listBaselines(config: ResolvedConfig): Array<{ platform: string; name: string; path: string }> {
  const baselines = path.join(config.sentinelDir, 'visual', 'baselines')
  if (!fs.existsSync(baselines)) return []

  const result: Array<{ platform: string; name: string; path: string }> = []
  for (const platform of fs.readdirSync(baselines)) {
    const platformDir = path.join(baselines, platform)
    if (!fs.statSync(platformDir).isDirectory()) continue
    for (const file of fs.readdirSync(platformDir)) {
      if (!file.endsWith('.png')) continue
      result.push({
        platform,
        name: file.replace(/\.png$/, ''),
        path: path.join(platformDir, file),
      })
    }
  }
  return result
}
