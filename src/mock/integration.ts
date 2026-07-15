import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'
import type { ResolvedConfig } from '../config/types.js'
import { findScreenFiles } from '../catalog/registry.js'

export interface MockIntegrationConfig {
  fixtures: Array<{ platform: string; path: string }>
}

export interface MockIntegrationIssue {
  severity: 'error' | 'warning'
  code: string
  message: string
  fix?: string
}

const SCREEN_STUB_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: 'StubData', pattern: /\bStubData\b/ },
  { label: 'PreviewData', pattern: /\bPreviewData\b/ },
  { label: 'SampleData', pattern: /\bSampleData\b/ },
  { label: 'MockData', pattern: /\bMockData\b/ },
  { label: 'FakeData', pattern: /\bFakeData\b/ },
  { label: 'Fixtures', pattern: /\bFixtures\b/ },
]

function walkFiles(dir: string, matcher: (file: string) => boolean, results: string[] = [], depth = 0): string[] {
  if (!existsSync(dir) || depth > 8) return results
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      walkFiles(full, matcher, results, depth + 1)
    } else if (matcher(full)) {
      results.push(full)
    }
  }
  return results
}

function walkDirs(dir: string, matcher: (entryPath: string) => boolean, results: string[] = [], depth = 0): string[] {
  if (!existsSync(dir) || depth > 8) return results
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    let stat
    try {
      stat = statSync(full)
    } catch {
      continue
    }

    if (!stat.isDirectory()) continue
    if (matcher(full)) results.push(full)
    walkDirs(full, matcher, results, depth + 1)
  }
  return results
}

function rel(projectRoot: string, file: string): string {
  return path.relative(projectRoot, file) || file
}

function findGoogleDebugAssetFixtures(projectRoot: string, googlePath: string): string[] {
  const googleRoot = path.join(projectRoot, googlePath)
  return walkDirs(
    googleRoot,
    (entryPath) => entryPath.endsWith(`${path.sep}fixtures`) && entryPath.includes(`${path.sep}src${path.sep}debug${path.sep}assets${path.sep}`),
  )
}

function findGoogleDebugKotlinFiles(projectRoot: string, googlePath: string): string[] {
  const googleRoot = path.join(projectRoot, googlePath)
  return walkFiles(
    googleRoot,
    (file) => {
      if (!file.endsWith('.kt') && !file.endsWith('.java')) return false
      return file.includes(`${path.sep}src${path.sep}debug${path.sep}`)
    },
  )
}

function findAppleRegistration(projectRoot: string, applePath: string): string[] {
  const appleRoot = path.join(projectRoot, applePath)
  return walkFiles(
    appleRoot,
    (file) => file.endsWith('.swift'),
  ).filter((file) => {
    const content = readFileSync(file, 'utf8')
    return content.includes('MockURLProtocol.self')
      || content.includes('URLProtocol.registerClass(MockURLProtocol.self)')
      || content.includes('protocolClasses = [MockURLProtocol.self')
  })
}

export function findFixturePathCandidates(
  projectRoot: string,
  fixtures: Array<{ platform: string; path: string }>,
  fixture: string,
): string[] {
  return fixtures
    .map(({ path: fixtureRoot }) => path.join(projectRoot, fixtureRoot, fixture))
    .filter((candidate, index, all) => all.indexOf(candidate) === index)
}

export function pluraliseFixtureDirectory(id: string): string {
  if (id.endsWith('s')) return id
  if (id.endsWith('y') && !['ay', 'ey', 'oy', 'uy'].some((suffix) => id.endsWith(suffix))) {
    return id.slice(0, -1) + 'ies'
  }
  return id + 's'
}

export function checkMockIntegration(
  config: ResolvedConfig,
  mockConfig: MockIntegrationConfig,
): MockIntegrationIssue[] {
  const issues: MockIntegrationIssue[] = []

  const fixtureRoots = mockConfig.fixtures.map(({ path: fixturePath }) => path.join(config.projectRoot, fixturePath))
  if (fixtureRoots.length === 0) {
    issues.push({
      severity: 'error',
      code: 'fixture-roots-missing',
      message: 'mock-config.json does not declare any fixture roots',
      fix: 'Add a fixtures array under sentinel/schemas/platform/mock-config.json',
    })
  }

  for (const fixtureRoot of fixtureRoots) {
    if (!existsSync(fixtureRoot)) {
      issues.push({
        severity: 'error',
        code: 'fixture-root-not-found',
        message: `Fixture root not found: ${rel(config.projectRoot, fixtureRoot)}`,
        fix: 'Create the fixture directory or fix the path in mock-config.json',
      })
    }
  }

  if (config.platforms.apple?.output.mock) {
    const output = path.join(config.projectRoot, config.platforms.apple.output.mock)
    if (!existsSync(output)) {
      issues.push({
        severity: 'error',
        code: 'apple-mock-output-missing',
        message: `Generated Apple mock transport missing: ${config.platforms.apple.output.mock}`,
        fix: 'Run sentinel mock:generate',
      })
    }

    const registrations = findAppleRegistration(config.projectRoot, config.platforms.apple.path)
    if (registrations.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'apple-mock-registration-missing',
        message: 'No Apple runtime registration for MockURLProtocol was found',
        fix: 'Register MockURLProtocol in the debug app entry point or session configuration',
      })
    }
  }

  if (config.platforms.google?.output.mock) {
    const output = path.join(config.projectRoot, config.platforms.google.output.mock)
    if (!existsSync(output)) {
      issues.push({
        severity: 'error',
        code: 'google-mock-output-missing',
        message: `Generated Google mock transport missing: ${config.platforms.google.output.mock}`,
        fix: 'Run sentinel mock:generate',
      })
    }

    if (!config.platforms.google.output.mock.includes('/src/debug/')) {
      issues.push({
        severity: 'warning',
        code: 'google-mock-output-not-debug',
        message: `Google mock output is not in a debug source set: ${config.platforms.google.output.mock}`,
        fix: 'Write MockDispatcher.kt into src/debug so it never ships in release builds',
      })
    }

    const assetDirs = findGoogleDebugAssetFixtures(config.projectRoot, config.platforms.google.path)
    if (assetDirs.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'google-fixtures-assets-missing',
        message: 'No Android debug assets/fixtures directory was found',
        fix: 'Copy or symlink Sentinel fixtures into app/src/debug/assets/fixtures',
      })
    }

    const debugFiles = findGoogleDebugKotlinFiles(config.projectRoot, config.platforms.google.path)
    const registrationFile = debugFiles.find((file) => {
      const content = readFileSync(file, 'utf8')
      return content.includes('MockDispatcher(') && content.includes('MockWebServer')
    })
    if (!registrationFile) {
      issues.push({
        severity: 'warning',
        code: 'google-mock-registration-missing',
        message: 'No Android debug module referencing MockDispatcher + MockWebServer was found',
        fix: 'Wire MockDispatcher into a debug-only network module',
      })
    }
  }

  for (const screenFile of findScreenFiles(config.projectRoot)) {
    const absPath = path.join(config.projectRoot, screenFile)
    const content = readFileSync(absPath, 'utf8')
    for (const { label, pattern } of SCREEN_STUB_PATTERNS) {
      if (!pattern.test(content)) continue
      issues.push({
        severity: 'warning',
        code: 'screen-local-stub',
        message: `Screen file references local stub source "${label}": ${screenFile}`,
        fix: 'Move screen state behind repositories/ViewModels and load Sentinel-owned fixtures there',
      })
      break
    }
  }

  return issues
}
