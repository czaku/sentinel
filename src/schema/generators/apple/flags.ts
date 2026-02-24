import path from 'path'
import type { FeatureFlagsSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, hashFile } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateAppleFlags(config: ResolvedConfig): void {
  const platform = config.platforms.apple
  if (!platform?.output?.flags) return

  const flagsPath = path.join(config.platformDir, 'feature-flags.json')
  const schema = readJSON<FeatureFlagsSchema>(flagsPath)

  const appleFlags = schema.flags.filter(f => f.platforms.includes('apple'))

  const output = [
    generatedHeader('sentinel/generators/apple/flags', 'sentinel/schemas/platform/feature-flags.json', hashFile(flagsPath)),
    `import Foundation`,
    ``,
    `// swiftlint:disable all`,
    `public final class FeatureFlags {`,
    `  private init() {}`,
    ``,
    `  // MARK: — Remote override (set from API response or local debug)`,
    `  private static var overrides: [String: Bool] = [:]`,
    ``,
    `  public static func override(_ key: String, enabled: Bool) {`,
    `    overrides[key] = enabled`,
    `  }`,
    ``,
    `  public static func reset() { overrides = [:] }`,
    ``,
    `  private static func resolve(_ key: String, default defaultValue: Bool) -> Bool {`,
    `    return overrides[key] ?? defaultValue`,
    `  }`,
    ``,
    `  // MARK: — Flags`,
    ``,
    ...appleFlags.map(flag => [
      flag.description ? `  /// ${flag.description}` : null,
      flag.milestone ? `  /// Milestone: ${flag.milestone}${flag.tier ? ` · Tier: ${flag.tier}` : ''}` : null,
      `  public static var ${toCamel(flag.key)}: Bool {`,
      `    resolve("${flag.key}", default: ${flag.defaultEnabled})`,
      `  }`,
      ``,
    ].filter(Boolean).join('\n')),
    `}`,
    `// swiftlint:enable all`,
  ].join('\n')

  writeFile(platform.output.flags, output)
  log.success(`Apple feature flags → ${platform.output.flags}`)
}

function toCamel(key: string): string {
  return key
    .toLowerCase()
    .replace(/[_.]([a-zA-Z])/g, (_, c: string) => c.toUpperCase())
}
