import { describe, it, expect } from 'vitest'
import type { SentinelReport } from '../../config/types.js'
import { buildMarkdownReport } from '../../report/builder.js'

function makeReport(overrides: Partial<SentinelReport> = {}): SentinelReport {
  return {
    project: 'testapp',
    version: '1.0.0',
    timestamp: '2026-01-01T00:00:00.000Z',
    passed: true,
    results: [],
    summary: { total: 0, errors: 0, warnings: 0, infos: 0 },
    ...overrides,
  }
}

describe('buildMarkdownReport', () => {
  it('contains project name and version', () => {
    const report = makeReport()
    const md = buildMarkdownReport(report)
    expect(md).toContain('testapp')
    expect(md).toContain('1.0.0')
  })

  it('shows ✅ when passed', () => {
    const md = buildMarkdownReport(makeReport({ passed: true }))
    expect(md).toContain('✅')
    expect(md).not.toContain('❌')
  })

  it('shows ❌ when failed', () => {
    const md = buildMarkdownReport(makeReport({ passed: false }))
    expect(md).toContain('❌')
  })

  it('renders results table', () => {
    const report = makeReport({
      results: [{
        layer: 'schema',
        passed: true,
        issues: [],
        durationMs: 42,
        checkedCount: 5,
      }],
      summary: { total: 5, errors: 0, warnings: 0, infos: 0 },
    })
    const md = buildMarkdownReport(report)
    expect(md).toContain('| schema |')
    expect(md).toContain('5')
  })

  it('lists errors in failures section', () => {
    const report = makeReport({
      passed: false,
      results: [{
        layer: 'chaos',
        passed: false,
        issues: [{
          severity: 'error',
          layer: 'chaos',
          rule: 'auth.no-token',
          message: 'Protected endpoint returned 200 without token',
          fix: 'Add auth guard',
        }],
        durationMs: 100,
        checkedCount: 3,
      }],
      summary: { total: 3, errors: 1, warnings: 0, infos: 0 },
    })
    const md = buildMarkdownReport(report)
    expect(md).toContain('auth.no-token')
    expect(md).toContain('Protected endpoint returned 200 without token')
    expect(md).toContain('Add auth guard')
  })

  it('includes AI analysis when provided', () => {
    const report = makeReport({ passed: false })
    const analysis = {
      summary: 'Two auth failures detected',
      prioritisedActions: [
        { action: 'Add auth middleware to /workouts', priority: 'critical', layer: 'chaos' },
      ],
    }
    const md = buildMarkdownReport(report, analysis)
    expect(md).toContain('Brain Analysis')
    expect(md).toContain('Two auth failures detected')
    expect(md).toContain('Add auth middleware')
  })

  it('includes generated-by footer', () => {
    const md = buildMarkdownReport(makeReport())
    expect(md).toContain('Sentinel')
  })
})
