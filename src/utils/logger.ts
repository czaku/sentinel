import chalk from 'chalk'
import type { ValidationIssue, SentinelReport } from '../config/types.js'

export const log = {
  info:    (msg: string) => console.log(chalk.cyan('  ℹ'), msg),
  success: (msg: string) => console.log(chalk.green('  ✓'), msg),
  warn:    (msg: string) => console.log(chalk.yellow('  ⚠'), msg),
  error:   (msg: string) => console.log(chalk.red('  ✗'), msg),
  dim:     (msg: string) => console.log(chalk.dim('  ·'), msg),
  blank:   ()            => console.log(),
  header:  (msg: string) => console.log(chalk.bold.white(`\n  ${msg}`)),
  rule:    ()            => console.log(chalk.dim('  ' + '─'.repeat(60))),
}

export function printIssue(issue: ValidationIssue): void {
  const prefix = issue.severity === 'error'
    ? chalk.red('  ✗')
    : issue.severity === 'warning'
      ? chalk.yellow('  ⚠')
      : chalk.cyan('  ℹ')

  const location = [issue.platform, issue.feature, issue.file]
    .filter(Boolean)
    .join(' › ')

  console.log(`${prefix} ${chalk.dim(location ? `[${location}]`  : '')} ${issue.message}`)
  if (issue.fix) {
    console.log(`     ${chalk.dim('fix:')} ${chalk.dim(issue.fix)}`)
  }
}

export function printReport(report: SentinelReport): void {
  log.blank()
  console.log(chalk.bold.white(`  Sentinel — ${report.project} v${report.version}`))
  console.log(chalk.dim(`  ${report.timestamp}`))
  log.rule()

  for (const result of report.results) {
    const icon = result.passed ? chalk.green('✓') : chalk.red('✗')
    const label = chalk.bold(result.layer.padEnd(20))
    const stats = chalk.dim(`${result.checkedCount} checked · ${result.durationMs}ms`)
    console.log(`  ${icon} ${label} ${stats}`)

    if (!result.passed) {
      for (const issue of result.issues) {
        printIssue(issue)
      }
    }
  }

  log.rule()

  const { errors, warnings, infos } = report.summary
  if (report.passed) {
    log.success(chalk.bold('All checks passed'))
  } else {
    const parts = [
      errors   > 0 ? chalk.red(`${errors} error${errors !== 1 ? 's' : ''}`)     : null,
      warnings > 0 ? chalk.yellow(`${warnings} warning${warnings !== 1 ? 's' : ''}`) : null,
      infos    > 0 ? chalk.cyan(`${infos} info`)                                  : null,
    ].filter(Boolean)
    log.error(`${parts.join(chalk.dim(', '))}`)
  }
  log.blank()
}

export function buildReport(
  project: string,
  version: string,
  results: import('../config/types.js').ValidationResult[]
): SentinelReport {
  const issues = results.flatMap(r => r.issues)
  return {
    project,
    version,
    timestamp: new Date().toISOString(),
    passed: results.every(r => r.passed),
    results,
    summary: {
      total:    issues.length,
      errors:   issues.filter(i => i.severity === 'error').length,
      warnings: issues.filter(i => i.severity === 'warning').length,
      infos:    issues.filter(i => i.severity === 'info').length,
    },
  }
}
