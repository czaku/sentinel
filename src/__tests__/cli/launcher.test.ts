import { spawnSync } from 'child_process'
import { describe, expect, it } from 'vitest'

describe('sentinel launcher', () => {
  it('prints help without side effects', () => {
    const result = spawnSync(process.execPath, ['bin/sentinel.js', '--help'], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Usage: sentinel schema:validate')
    expect(result.stderr).toBe('')
  })

  it('prints the package version', () => {
    const result = spawnSync(process.execPath, ['bin/sentinel.js', '--version'], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('0.2.1')
    expect(result.stderr).toBe('')
  })
})
