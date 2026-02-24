#!/usr/bin/env node
import path from 'path'
import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig } from '../config/loader.js'
import { generateAll, validateAll } from '../schema/index.js'
import { buildFeatureMatrix, printMatrix } from '../contracts/feature-matrix.js'
import { runChaos } from '../chaos/runner.js'
import { runMaestroFlows } from '../flows/maestro.js'
import { runPlaywrightFlows } from '../flows/playwright.js'
import { runPerf } from '../perf/runner.js'
import { checkVisualParity } from '../visual/parity.js'
import { listBaselines } from '../visual/capture.js'
import { compareScreenshots } from '../visual/compare.js'
import { analyzeReport } from '../brain/analyzer.js'
import { reportFailuresToGitHub } from '../brain/issues.js'
import { buildMarkdownReport, writeToGitHubSummary, writeReportFile } from '../report/builder.js'
import { buildReport, printReport } from '../utils/logger.js'
import type { ValidationResult } from '../config/types.js'

const program = new Command()

program
  .name('sentinel')
  .description('Product integrity guardian — schema, contracts, chaos, visual, perf, and flow testing')
  .version('1.0.0')

// ─── schema:generate ──────────────────────────────────────────────────────────

program
  .command('schema:generate')
  .alias('generate')
  .description('Generate platform files (tokens, strings, flags, models, navigation) from schemas')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    await generateAll(config)
  })

// ─── schema:validate ──────────────────────────────────────────────────────────

program
  .command('schema:validate')
  .alias('validate')
  .description('Validate schemas: completeness, drift, staleness')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const results = await validateAll(config)
    const report = buildReport(config.project, config.version, results)
    printReport(report)
    if (!report.passed) process.exit(1)
  })

// ─── contracts ────────────────────────────────────────────────────────────────

program
  .command('contracts')
  .description('Cross-layer contract analysis: feature matrix, orphan endpoints, missing API')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const { rows, result } = await buildFeatureMatrix(config)

    const platformKeys = Object.keys(config.platforms) as any[]
    console.log()
    printMatrix(rows, platformKeys)
    console.log()

    const report = buildReport(config.project, config.version, [result])
    printReport(report)
    if (!report.passed) process.exit(1)
  })

program
  .command('contracts:matrix')
  .description('Print feature × platform completeness matrix')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const { rows } = await buildFeatureMatrix(config)
    const platformKeys = Object.keys(config.platforms) as any[]
    console.log()
    printMatrix(rows, platformKeys)
    console.log()
  })

// ─── chaos ───────────────────────────────────────────────────────────────────

program
  .command('chaos')
  .description('Run chaos scenarios from sentinel/chaos/')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('--scenario <id>', 'Run a specific scenario by ID (partial match)')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const result = await runChaos(config, opts.scenario)
    const report = buildReport(config.project, config.version, [result])
    printReport(report)
    if (!report.passed) process.exit(1)
  })

// ─── flows ────────────────────────────────────────────────────────────────────

program
  .command('flows')
  .description('Run Maestro (mobile) and Playwright (web) UI flow tests')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('--platform <platform>', 'Filter: maestro | playwright')
  .option('--filter <name>', 'Filter flows by name')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const allResults: ValidationResult[] = []

    if (!opts.platform || opts.platform === 'maestro') {
      allResults.push(await runMaestroFlows(config, opts.filter))
    }
    if (!opts.platform || opts.platform === 'playwright') {
      allResults.push(await runPlaywrightFlows(config, opts.filter))
    }

    const report = buildReport(config.project, config.version, allResults)
    printReport(report)
    if (!report.passed) process.exit(1)
  })

// ─── perf ────────────────────────────────────────────────────────────────────

program
  .command('perf')
  .description('Run API performance budget checks from sentinel/perf/budgets.yaml')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('--filter <endpoint>', 'Filter by endpoint path (partial match)')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const result = await runPerf(config, opts.filter)
    const report = buildReport(config.project, config.version, [result])
    printReport(report)
    if (!report.passed) process.exit(1)
  })

// ─── visual ──────────────────────────────────────────────────────────────────

program
  .command('visual:parity')
  .description('AI-powered visual parity check between two platforms')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('--platform-a <platform>', 'First platform (default: apple)', 'apple')
  .option('--platform-b <platform>', 'Second platform (default: google)', 'google')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const result = await checkVisualParity(config, opts.platformA, opts.platformB)
    const report = buildReport(config.project, config.version, [result])
    printReport(report)
    if (!report.passed) process.exit(1)
  })

program
  .command('visual:compare')
  .description('Compare screenshots against baselines')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('--current <dir>', 'Directory containing current screenshots (default: same as baselines)')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const baselines = path.join(config.sentinelDir, 'visual', 'baselines')
    const currentDir = opts.current ?? baselines
    const result = await compareScreenshots(config, currentDir)
    const report = buildReport(config.project, config.version, [result])
    printReport(report)
    if (!report.passed) process.exit(1)
  })

program
  .command('visual:list')
  .description('List captured visual baselines')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .action((opts) => {
    const config = loadConfig(opts.config)
    const baselines = listBaselines(config)
    if (baselines.length === 0) {
      console.log(chalk.dim('No baselines found. Run "sentinel visual:capture" first.'))
    } else {
      for (const b of baselines) {
        console.log(`  ${chalk.dim(b.platform + '/')}${b.name}  ${chalk.dim(b.path)}`)
      }
    }
  })

// ─── brain ───────────────────────────────────────────────────────────────────

program
  .command('brain')
  .description('AI analysis of failures + optional GitHub issue creation')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('--report <path>', 'Path to a saved sentinel-report.json')
  .option('--create-issues', 'Create/update GitHub issues for failures')
  .action(async (opts) => {
    const config = loadConfig(opts.config)

    let sentinelReport: any
    if (opts.report) {
      const { readFileSync } = await import('fs')
      sentinelReport = JSON.parse(readFileSync(opts.report, 'utf-8'))
    } else {
      // Run all checks first
      const allResults: ValidationResult[] = []
      const schemaResults = await validateAll(config)
      allResults.push(...schemaResults)
      const { result: contractsResult } = await buildFeatureMatrix(config)
      allResults.push(contractsResult)
      const chaosResult = await runChaos(config)
      allResults.push(chaosResult)
      sentinelReport = buildReport(config.project, config.version, allResults)
    }

    const analysis = await analyzeReport(sentinelReport)
    if (analysis) {
      console.log()
      console.log(chalk.bold('🧠 Brain Analysis'))
      console.log(chalk.dim('─'.repeat(60)))
      console.log(chalk.dim('Summary:'), analysis.summary)
      if (analysis.prioritisedActions.length > 0) {
        console.log()
        console.log(chalk.bold('Prioritised Actions:'))
        for (const action of analysis.prioritisedActions) {
          const badge = action.priority === 'critical' ? chalk.red('●') :
                        action.priority === 'high' ? chalk.yellow('●') :
                        action.priority === 'medium' ? chalk.blue('●') : chalk.dim('●')
          console.log(`  ${badge} [${action.layer}] ${action.action}`)
        }
      }
    }

    if (opts.createIssues) {
      await reportFailuresToGitHub(config, sentinelReport)
    }

    const report = buildReport(config.project, config.version, sentinelReport.results ?? [])
    printReport(report)
    if (!report.passed) process.exit(1)
  })

// ─── report ──────────────────────────────────────────────────────────────────

program
  .command('report')
  .description('Generate a Markdown or HTML report from the last run')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('-o, --output <path>', 'Output file path (default: sentinel-report.md)')
  .option('--format <format>', 'Report format: md | html (default: md)', 'md')
  .action(async (opts) => {
    const config = loadConfig(opts.config)

    // Run all checks
    const allResults: ValidationResult[] = []
    const schemaResults = await validateAll(config)
    allResults.push(...schemaResults)
    const { result: contractsResult } = await buildFeatureMatrix(config)
    allResults.push(contractsResult)
    const chaosResult = await runChaos(config)
    allResults.push(chaosResult)

    const report = buildReport(config.project, config.version, allResults)

    const outputPath = opts.output ?? `sentinel-report.${opts.format}`
    writeReportFile(outputPath, report, opts.format)
    writeToGitHubSummary(report)

    printReport(report)
    console.log(chalk.dim(`\nReport written to ${outputPath}`))
    if (!report.passed) process.exit(1)
  })

// ─── all ──────────────────────────────────────────────────────────────────────

program
  .command('all')
  .description('Run all sentinel checks: schema, contracts, chaos, flows, perf')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .option('--report', 'Write a report file (sentinel-report.md)')
  .option('--create-issues', 'Create/update GitHub issues for failures')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const allResults: ValidationResult[] = []

    const schemaResults = await validateAll(config)
    allResults.push(...schemaResults)

    const { result: contractsResult } = await buildFeatureMatrix(config)
    allResults.push(contractsResult)

    const chaosResult = await runChaos(config)
    allResults.push(chaosResult)

    const maestroResult = await runMaestroFlows(config)
    allResults.push(maestroResult)

    const playwrightResult = await runPlaywrightFlows(config)
    allResults.push(playwrightResult)

    const perfResult = await runPerf(config)
    allResults.push(perfResult)

    const sentinelReport = buildReport(config.project, config.version, allResults)

    // AI analysis
    const analysis = await analyzeReport(sentinelReport)

    // Write report
    if (opts.report) {
      writeReportFile('sentinel-report.md', sentinelReport)
    }
    writeToGitHubSummary(sentinelReport, analysis ?? undefined)

    // GitHub issues
    if (opts.createIssues) {
      await reportFailuresToGitHub(config, sentinelReport)
    }

    printReport(sentinelReport)
    if (!sentinelReport.passed) process.exit(1)
  })

// ─── init ─────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Scaffold sentinel.yaml and sentinel/ directory structure in the current project')
  .option('--project <name>', 'Project name')
  .action(async (opts) => {
    const { initProject } = await import('./init.js')
    await initProject(opts.project ?? process.cwd().split('/').pop() ?? 'myproject')
  })

program.parse()
