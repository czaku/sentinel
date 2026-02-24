import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { ResolvedConfig } from '../../../config/types.js'
import { detectDrift } from '../../../schema/validators/drift.js'

function makeConfig(features: object[]): { config: ResolvedConfig; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-test-'))
  const schemasDir = path.join(dir, 'schemas')
  fs.mkdirSync(path.join(schemasDir, 'features'), { recursive: true })
  fs.mkdirSync(path.join(schemasDir, 'design'), { recursive: true })
  fs.mkdirSync(path.join(schemasDir, 'platform'), { recursive: true })

  for (let i = 0; i < features.length; i++) {
    fs.writeFileSync(
      path.join(schemasDir, 'features', `feature-${i}.json`),
      JSON.stringify(features[i])
    )
  }

  const config: ResolvedConfig = {
    sentinel: '1.0', project: 'testapp', version: '1.0.0',
    projectRoot: dir, sentinelDir: dir, schemasDir,
    featuresDir: path.join(schemasDir, 'features'),
    designDir: path.join(schemasDir, 'design'),
    platformDir: path.join(schemasDir, 'platform'),
    modelsDir: path.join(schemasDir, 'models'),
    platforms: {
      api: { path: './api', language: 'typescript' },
      apple: { path: './apple', language: 'swift', output: { tokens: '', strings: '', flags: '' } },
      google: { path: './google', language: 'kotlin', output: { tokens: '', strings: '', flags: '' } },
    },
  }

  return { config, dir }
}

describe('detectDrift', () => {
  let dir: string
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('passes when all shipped features have consistent platform statuses', async () => {
    const { config, dir: d } = makeConfig([{
      $sentinel: '1.0', type: 'feature', id: 'workout-logging',
      name: 'Workout Logging', milestone: 1, status: 'shipped', tier: 'free',
      platforms: {
        api:    { status: 'shipped', endpoints: ['POST /workouts'] },
        apple:  { status: 'shipped', screens: ['WorkoutView'] },
        google: { status: 'shipped', screens: ['WorkoutScreen'] },
      },
    }])
    dir = d

    const result = await detectDrift(config)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors).toHaveLength(0)
  })

  it('raises warning when apple is shipped but google is only planned', async () => {
    const { config, dir: d } = makeConfig([{
      $sentinel: '1.0', type: 'feature', id: 'workout-logging',
      name: 'Workout Logging', milestone: 1, status: 'shipped', tier: 'free',
      platforms: {
        api:    { status: 'shipped', endpoints: ['POST /workouts'] },
        apple:  { status: 'shipped', screens: [] },   // empty screens — no file check
        google: { status: 'planned', screens: [] },   // planned — parity drift warning
      },
    }])
    dir = d

    const result = await detectDrift(config)
    const warnings = result.issues.filter(i => i.severity === 'warning')
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings.some(w => w.message.includes('planned'))).toBe(true)
    // Cross-platform parity warnings do not fail the check
    expect(result.passed).toBe(true)
  })

  it('raises error when shipped screen file is missing', async () => {
    // Needs 2+ platforms for drift to check screen files
    const { config, dir: d } = makeConfig([{
      $sentinel: '1.0', type: 'feature', id: 'workout-logging',
      name: 'Workout Logging', milestone: 1, status: 'shipped', tier: 'free',
      platforms: {
        apple:  { status: 'shipped', screens: ['NonExistentScreen'] },
        google: { status: 'shipped', screens: [] },
      },
    }])
    dir = d
    // Create platform dirs so the check runs (empty = no files found)
    fs.mkdirSync(path.join(d, 'apple'), { recursive: true })
    fs.mkdirSync(path.join(d, 'google'), { recursive: true })

    const result = await detectDrift(config)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].message).toContain('NonExistentScreen')
  })

  it('passes for in-progress features with mixed platform statuses', async () => {
    // in-progress features can have some platforms ahead of others — not drift
    const { config, dir: d } = makeConfig([{
      $sentinel: '1.0', type: 'feature', id: 'new-feature',
      name: 'New Feature', milestone: 2, status: 'in-progress', tier: 'pro',
      platforms: {
        api:   { status: 'in-progress' },
        apple: { status: 'in-progress' },
      },
    }])
    dir = d

    const result = await detectDrift(config)
    const errors = result.issues.filter(i => i.severity === 'error')
    expect(errors).toHaveLength(0)
  })

  it('returns a valid ValidationResult structure', async () => {
    const { config, dir: d } = makeConfig([])
    dir = d
    const result = await detectDrift(config)
    expect(result.layer).toBe('drift')
    expect(typeof result.passed).toBe('boolean')
    expect(Array.isArray(result.issues)).toBe(true)
    expect(typeof result.durationMs).toBe('number')
    expect(typeof result.checkedCount).toBe('number')
  })
})
