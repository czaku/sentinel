/**
 * Invariants Checker
 * Verifies that specific files contain required substrings.
 * Configured via the `invariants` section of sentinel.yaml.
 *
 * Use this for platform-specific requirements that must never regress —
 * e.g. UILaunchScreen in iOS Info.plist, required manifest entries, etc.
 */
import fs from 'fs'
import path from 'path'
import type { ResolvedConfig, ValidationResult, ValidationIssue } from '../../config/types.js'

export function checkInvariants(config: ResolvedConfig): ValidationResult {
  const start = performance.now()
  const issues: ValidationIssue[] = []
  const checks = config.invariants ?? []

  for (const check of checks) {
    const filePath = path.resolve(config.projectRoot, check.file)

    if (!fs.existsSync(filePath)) {
      issues.push({
        severity: 'error',
        layer: 'invariants',
        rule: 'file-exists',
        file: filePath,
        message: `Invariant check failed — file not found: ${check.file}`,
        fix: check.fix,
      })
      continue
    }

    const content = fs.readFileSync(filePath, 'utf8')
    if (!content.includes(check.contains)) {
      issues.push({
        severity: 'error',
        layer: 'invariants',
        rule: 'contains',
        file: filePath,
        message: check.error,
        fix: check.fix ?? `Ensure "${check.contains}" is present in ${check.file}`,
      })
    }
  }

  return {
    layer: 'invariants',
    passed: issues.filter(i => i.severity === 'error').length === 0,
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: checks.length,
  }
}
