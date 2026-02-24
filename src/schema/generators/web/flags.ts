import path from 'path'
import type { FeatureFlagsSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateWebFlags(config: ResolvedConfig): void {
  const platform = config.platforms.web ?? config.platforms['web-admin']
  if (!platform?.output?.flags) return

  const flagsPath = path.join(config.platformDir, 'feature-flags.json')
  const schema = readJSON<FeatureFlagsSchema>(flagsPath)

  const webFlags = schema.flags.filter(f =>
    f.platforms.includes('web') || f.platforms.includes('web-admin')
  )

  const defaults = Object.fromEntries(webFlags.map(f => [toCamel(f.key), f.defaultEnabled]))

  const output = [
    generatedHeader('sentinel/generators/web/flags', 'sentinel/schemas/platform/feature-flags.json'),
    `type FlagKey = ${webFlags.map(f => `'${toCamel(f.key)}'`).join(' | ')}`,
    ``,
    `const defaults: Record<FlagKey, boolean> = ${JSON.stringify(defaults, null, 2)} as const`,
    ``,
    `const overrides: Partial<Record<FlagKey, boolean>> = {}`,
    ``,
    `export const featureFlags = {`,
    ...webFlags.map(f => {
      const lines = []
      if (f.description) lines.push(`  /** ${f.description} */`)
      lines.push(`  get ${toCamel(f.key)}(): boolean { return overrides['${toCamel(f.key)}'] ?? defaults['${toCamel(f.key)}'] },`)
      return lines.join('\n')
    }),
    ``,
    `  override(key: FlagKey, value: boolean) { overrides[key] = value },`,
    `  reset() { Object.keys(overrides).forEach(k => delete overrides[k as FlagKey]) },`,
    `}`,
  ].join('\n')

  writeFile(platform.output.flags, output)
  log.success(`Web feature flags → ${platform.output.flags}`)
}

function toCamel(key: string): string {
  return key
    .toLowerCase()
    .replace(/[_.]([a-zA-Z])/g, (_, c: string) => c.toUpperCase())
}
