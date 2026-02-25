#!/usr/bin/env node
/**
 * Sentinel CLI launcher.
 *
 * Runs the TypeScript source directly via tsx so no build step is required.
 * tsx is bundled in sentinel's own node_modules, so this works regardless
 * of what the parent project has installed.
 */
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const tsx  = join(__dir, '../node_modules/.bin/tsx')
const entry = join(__dir, '../src/cli/index.ts')

const child = spawn(tsx, [entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

child.on('close', (code) => process.exit(code ?? 0))
child.on('error', (err) => {
  console.error(`sentinel: failed to start tsx — ${err.message}`)
  process.exit(1)
})
