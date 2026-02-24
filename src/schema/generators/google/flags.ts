import path from 'path'
import type { FeatureFlagsSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateGoogleFlags(config: ResolvedConfig): void {
  const platform = config.platforms.google
  if (!platform?.output?.flags) return

  const flagsPath = path.join(config.platformDir, 'feature-flags.json')
  const schema = readJSON<FeatureFlagsSchema>(flagsPath)

  const googleFlags = schema.flags.filter(f => f.platforms.includes('google'))
  const pkg = derivePackage(platform.output.flags)

  const output = [
    generatedHeader('sentinel/generators/google/flags', 'sentinel/schemas/platform/feature-flags.json'),
    `package ${pkg}`,
    ``,
    `@Suppress("MemberVisibilityCanBePrivate", "unused")`,
    `object FeatureFlags {`,
    ``,
    `    // Remote override map — set from API response or debug menu`,
    `    private val overrides = mutableMapOf<String, Boolean>()`,
    ``,
    `    fun override(key: String, enabled: Boolean) { overrides[key] = enabled }`,
    `    fun reset() { overrides.clear() }`,
    `    private fun resolve(key: String, default: Boolean) = overrides[key] ?: default`,
    ``,
    ...googleFlags.map(flag => [
      flag.description ? `    /** ${flag.description} */` : null,
      flag.milestone ? `    // Milestone: ${flag.milestone}${flag.tier ? ` · Tier: ${flag.tier}` : ''}` : null,
      `    val ${toCamel(flag.key)}: Boolean`,
      `        get() = resolve("${flag.key}", ${flag.defaultEnabled})`,
      ``,
    ].filter(Boolean).join('\n')),
    `}`,
  ].join('\n')

  writeFile(platform.output.flags, output)
  log.success(`Google feature flags → ${platform.output.flags}`)
}

function derivePackage(outputPath: string): string {
  const match = outputPath.match(/kotlin[/\\](.+)[/\\][^/\\]+\.kt$/)
  if (!match) return 'com.app.core'
  return match[1].replace(/[/\\]/g, '.')
}

function toCamel(key: string): string {
  return key
    .toLowerCase()
    .replace(/[_.]([a-zA-Z])/g, (_, c: string) => c.toUpperCase())
}
