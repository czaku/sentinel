import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import type { SentinelConfig, ResolvedConfig } from './types.js'

const CONFIG_FILES = ['sentinel.yaml', 'sentinel.yml', 'sentinel.json']

export function findConfigFile(startDir: string): string | null {
  let dir = startDir
  while (true) {
    for (const name of CONFIG_FILES) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function loadConfig(configPath?: string): ResolvedConfig {
  const cwd = process.cwd()
  const filePath = configPath ?? findConfigFile(cwd)

  if (!filePath) {
    throw new Error(
      `No sentinel.yaml found. Run "sentinel init" to create one, or run from a project root.`
    )
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const ext = path.extname(filePath)
  const config = (ext === '.json' ? JSON.parse(raw) : yaml.load(raw)) as SentinelConfig

  validateConfig(config, filePath)

  const projectRoot = path.dirname(filePath)
  const location = config.location ?? './sentinel'
  const sentinelDir = path.resolve(projectRoot, location)
  const schemasDir = path.join(sentinelDir, 'schemas')

  return {
    ...config,
    projectRoot,
    sentinelDir,
    schemasDir,
    featuresDir: path.join(schemasDir, 'features'),
    designDir: path.join(schemasDir, 'design'),
    platformDir: path.join(schemasDir, 'platform'),
  }
}

function validateConfig(config: SentinelConfig, filePath: string): void {
  const errors: string[] = []

  if (!config.sentinel) errors.push('Missing required field: sentinel (version)')
  if (!config.project) errors.push('Missing required field: project')
  if (!config.version) errors.push('Missing required field: version')
  if (!config.platforms || Object.keys(config.platforms).length === 0) {
    errors.push('Missing required field: platforms (must declare at least one)')
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid sentinel.yaml at ${filePath}:\n${errors.map(e => `  • ${e}`).join('\n')}`
    )
  }
}

// ─── Sentinel Directory Structure ─────────────────────────────────────────────
// These paths are hardcoded — projects do not configure them.

export function getSentinelPaths(sentinelDir: string) {
  return {
    root:         sentinelDir,
    schemas:      path.join(sentinelDir, 'schemas'),
    features:     path.join(sentinelDir, 'schemas', 'features'),
    design:       path.join(sentinelDir, 'schemas', 'design'),
    platform:     path.join(sentinelDir, 'schemas', 'platform'),
    chaos:        path.join(sentinelDir, 'chaos'),
    flows: {
      root:       path.join(sentinelDir, 'flows'),
      maestro:    path.join(sentinelDir, 'flows', 'maestro'),
      playwright: path.join(sentinelDir, 'flows', 'playwright'),
    },
    visual: {
      root:       path.join(sentinelDir, 'visual'),
      baselines:  path.join(sentinelDir, 'visual', 'baselines'),
    },
    perf:         path.join(sentinelDir, 'perf'),
  }
}

export function ensureSentinelDir(sentinelDir: string): void {
  const paths = getSentinelPaths(sentinelDir)
  const dirs = [
    paths.schemas,
    paths.features,
    paths.design,
    paths.platform,
    paths.chaos,
    paths.flows.root,
    paths.flows.maestro,
    paths.flows.playwright,
    paths.visual.root,
    paths.visual.baselines,
    paths.perf,
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
