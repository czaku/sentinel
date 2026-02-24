#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import { loadConfig } from '../config/loader.js'
import { generateAll, validateAll } from '../schema/index.js'
import { buildFeatureMatrix, printMatrix } from '../contracts/feature-matrix.js'
import { runChaos } from '../chaos/runner.js'
import { buildReport, printReport } from '../utils/logger.js'
import type { ValidationResult } from '../config/types.js'

const program = new Command()

program
  .name('sentinel')
  .description('Product integrity guardian — schema, contracts, chaos, visual, and flow testing')
  .version('1.0.0')

// ─── schema:generate ──────────────────────────────────────────────────────────

program
  .command('schema:generate')
  .alias('generate')
  .description('Generate platform files (tokens, strings, flags) from schemas')
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

// ─── all ──────────────────────────────────────────────────────────────────────

program
  .command('all')
  .description('Run all sentinel checks: schema, contracts, chaos')
  .option('-c, --config <path>', 'Path to sentinel.yaml')
  .action(async (opts) => {
    const config = loadConfig(opts.config)
    const allResults: ValidationResult[] = []

    const schemaResults = await validateAll(config)
    allResults.push(...schemaResults)

    const { result: contractsResult } = await buildFeatureMatrix(config)
    allResults.push(contractsResult)

    const chaosResult = await runChaos(config)
    allResults.push(chaosResult)

    const report = buildReport(config.project, config.version, allResults)
    printReport(report)
    if (!report.passed) process.exit(1)
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
