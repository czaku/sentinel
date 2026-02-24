import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { ResolvedConfig } from '../../../config/types.js'
import { checkCompleteness } from '../../../schema/validators/completeness.js'

const EMPTY_NAV = { $sentinel: '1.0', type: 'navigation', version: '1.0.0', tabs: [], routes: [] }

function makeConfig(files: Record<string, object | null>): { config: ResolvedConfig; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'))
  const schemasDir = path.join(dir, 'schemas')

  const dirs = [
    path.join(schemasDir, 'features'),
    path.join(schemasDir, 'design'),
    path.join(schemasDir, 'platform'),
    path.join(schemasDir, 'models'),
  ]
  for (const d of dirs) fs.mkdirSync(d, { recursive: true })

  for (const [filePath, content] of Object.entries(files)) {
    if (content !== null) {
      const fullPath = path.join(schemasDir, filePath)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, JSON.stringify(content))
    }
  }

  const config: ResolvedConfig = {
    sentinel: '1.0',
    project: 'testapp',
    version: '1.0.0',
    projectRoot: dir,
    sentinelDir: dir,
    schemasDir,
    featuresDir: path.join(schemasDir, 'features'),
    designDir: path.join(schemasDir, 'design'),
    platformDir: path.join(schemasDir, 'platform'),
    modelsDir: path.join(schemasDir, 'models'),
    platforms: {
      apple: {
        path: './apple',
        language: 'swift',
        output: {
          tokens: path.join(dir, 'Tokens.swift'),
          strings: path.join(dir, 'Strings.swift'),
          flags: path.join(dir, 'Flags.swift'),
        },
      },
    },
  }

  return { config, dir }
}

describe('checkCompleteness', () => {
  let dir: string

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('passes when all required schemas exist', async () => {
    const { config, dir: d } = makeConfig({
      'design/tokens.json': { $sentinel: '1.0', type: 'tokens', version: '1.0.0', colors: {}, typography: {}, spacing: {} },
      'design/strings.json': { $sentinel: '1.0', type: 'strings', version: '1.0.0', locales: ['en'], strings: {} },
      'platform/feature-flags.json': { $sentinel: '1.0', type: 'feature-flags', version: '1.0.0', flags: [] },
      'platform/navigation.json': EMPTY_NAV,
    })
    dir = d

    const result = await checkCompleteness(config)
    expect(result.passed).toBe(true)
    expect(result.issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('reports error when tokens.json is missing', async () => {
    const { config, dir: d } = makeConfig({
      'design/strings.json': { $sentinel: '1.0', type: 'strings', version: '1.0.0', locales: ['en'], strings: {} },
      'platform/feature-flags.json': { $sentinel: '1.0', type: 'feature-flags', version: '1.0.0', flags: [] },
      'platform/navigation.json': EMPTY_NAV,
    })
    dir = d

    const result = await checkCompleteness(config)
    const errors = result.issues.filter(i => i.severity === 'error' && i.rule === 'completeness')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.message.includes('tokens.json'))).toBe(true)
  })

  it('validates feature schema required fields', async () => {
    const { config, dir: d } = makeConfig({
      'design/tokens.json': { $sentinel: '1.0', type: 'tokens', version: '1.0.0', colors: {}, typography: {}, spacing: {} },
      'design/strings.json': { $sentinel: '1.0', type: 'strings', version: '1.0.0', locales: ['en'], strings: {} },
      'platform/feature-flags.json': { $sentinel: '1.0', type: 'feature-flags', version: '1.0.0', flags: [] },
      'platform/navigation.json': EMPTY_NAV,
      'features/bad-feature.json': { type: 'feature', name: 'Bad Feature' }, // missing id, milestone, etc.
    })
    dir = d

    const result = await checkCompleteness(config)
    const featureErrors = result.issues.filter(i => i.severity === 'error' && i.rule === 'completeness')
    expect(featureErrors.length).toBeGreaterThan(0)
  })

  it('passes with a complete feature schema', async () => {
    const { config, dir: d } = makeConfig({
      'design/tokens.json': { $sentinel: '1.0', type: 'tokens', version: '1.0.0', colors: {}, typography: {}, spacing: {} },
      'design/strings.json': { $sentinel: '1.0', type: 'strings', version: '1.0.0', locales: ['en'], strings: {} },
      'platform/feature-flags.json': { $sentinel: '1.0', type: 'feature-flags', version: '1.0.0', flags: [] },
      'platform/navigation.json': EMPTY_NAV,
      'features/workout.json': {
        $sentinel: '1.0',
        type: 'feature',
        id: 'workout-logging',
        name: 'Workout Logging',
        milestone: 1,
        status: 'shipped',
        tier: 'free',
        platforms: {
          apple: { status: 'shipped', screens: ['WorkoutView'] },
          api: { status: 'shipped', endpoints: ['POST /workouts'] },
        },
      },
    })
    dir = d

    const result = await checkCompleteness(config)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors).toHaveLength(0)
  })
})
