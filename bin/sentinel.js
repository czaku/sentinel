#!/usr/bin/env node
/**
 * Sentinel CLI launcher.
 *
 * Runs the TypeScript source directly via tsx so no build step is required.
 * tsx is a runtime dependency and is resolved through Node's package resolver,
 * which supports both nested and hoisted npm installs.
 */
process.title = 'sentinel'
import { spawn } from 'child_process'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const tsx = require.resolve('tsx/cli')
const entry = join(__dir, '../src/cli/index.ts')

const child = spawn(process.execPath, [tsx, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

child.on('close', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error(`sentinel: failed to start tsx — ${err.message}`)
  process.exit(1)
})
