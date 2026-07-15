import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ResolvedConfig } from '../../config/types.js'
import {
  checkMockIntegration,
  findFixturePathCandidates,
  pluraliseFixtureDirectory,
} from '../../mock/integration.js'

function makeConfig(dir: string): ResolvedConfig {
  const sentinelDir = path.join(dir, 'sentinel')
  const schemasDir = path.join(sentinelDir, 'schemas')
  return {
    sentinel: '1.0',
    project: 'demo',
    version: '1.0.0',
    projectRoot: dir,
    sentinelDir,
    schemasDir,
    featuresDir: path.join(schemasDir, 'features'),
    designDir: path.join(schemasDir, 'design'),
    platformDir: path.join(schemasDir, 'platform'),
    modelsDir: path.join(schemasDir, 'models'),
    platforms: {
      apple: {
        path: 'apple',
        language: 'swift',
        output: {
          mock: 'apple/App/Core/MockURLProtocol.swift',
        },
      },
      google: {
        path: 'google',
        language: 'kotlin',
        output: {
          mock: 'google/app/src/debug/kotlin/com/example/MockDispatcher.kt',
        },
      },
    },
  }
}

describe('mock integration', () => {
  let dir = ''

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('finds fixtures across multiple declared roots', () => {
    const candidates = findFixturePathCandidates('/tmp/demo', [
      { platform: 'apple', path: 'sentinel/fixtures' },
      { platform: 'google', path: 'google/app/src/debug/assets/fixtures' },
    ], 'auth/me.json')

    expect(candidates).toEqual([
      '/tmp/demo/sentinel/fixtures/auth/me.json',
      '/tmp/demo/google/app/src/debug/assets/fixtures/auth/me.json',
    ])
  })

  it('does not double-pluralise fixture directories', () => {
    expect(pluraliseFixtureDirectory('notification-preferences')).toBe('notification-preferences')
    expect(pluraliseFixtureDirectory('category')).toBe('categories')
    expect(pluraliseFixtureDirectory('user')).toBe('users')
  })

  it('detects screen-level local stub drift', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-mock-'))
    const config = makeConfig(dir)

    fs.mkdirSync(path.join(dir, 'sentinel', 'fixtures'), { recursive: true })
    fs.mkdirSync(path.dirname(path.join(dir, 'apple/App/Core/MockURLProtocol.swift')), { recursive: true })
    fs.writeFileSync(path.join(dir, 'apple/App/Core/MockURLProtocol.swift'), 'final class MockURLProtocol {}')
    fs.mkdirSync(path.join(dir, 'apple/App'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'apple/App/App.swift'), 'URLProtocol.registerClass(MockURLProtocol.self)')

    fs.mkdirSync(path.dirname(path.join(dir, 'google/app/src/debug/kotlin/com/example/MockDispatcher.kt')), { recursive: true })
    fs.writeFileSync(path.join(dir, 'google/app/src/debug/kotlin/com/example/MockDispatcher.kt'), 'class MockDispatcher\nclass MockWebServer')
    fs.mkdirSync(path.join(dir, 'google/app/src/debug/assets/fixtures'), { recursive: true })

    fs.mkdirSync(path.join(dir, 'google/app/src/main/kotlin/com/example/features/home'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'google/app/src/main/kotlin/com/example/features/home/HomeScreen.kt'), 'val state = StubData.home')

    const issues = checkMockIntegration(config, {
      fixtures: [{ platform: 'shared', path: 'sentinel/fixtures' }],
    })

    expect(issues.some((issue) => issue.code === 'screen-local-stub')).toBe(true)
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false)
  })
})
