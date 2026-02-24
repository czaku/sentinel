import path from 'path'
import type { StringsSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, hashFile } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateAppleStrings(config: ResolvedConfig): void {
  const platform = config.platforms.apple
  if (!platform?.output?.strings) return

  const stringsPath = path.join(config.designDir, 'strings.json')
  const schema = readJSON<StringsSchema>(stringsPath)

  const output = [
    generatedHeader('sentinel/generators/apple/strings', 'sentinel/schemas/design/strings.json', hashFile(stringsPath)),
    `import Foundation`,
    ``,
    `// swiftlint:disable all`,
    `public enum Strings {`,
    generateStringNamespaces(schema),
    `}`,
    `// swiftlint:enable all`,
  ].join('\n')

  writeFile(platform.output.strings, output)
  log.success(`Apple strings → ${platform.output.strings}`)
}

function generateStringNamespaces(schema: StringsSchema): string {
  // Group keys by first namespace segment
  const namespaces = new Map<string, Map<string, string>>()

  for (const [key, value] of Object.entries(schema.strings)) {
    const dotIndex = key.indexOf('.')
    if (dotIndex === -1) {
      // Top-level key — put in _root namespace
      if (!namespaces.has('_root')) namespaces.set('_root', new Map())
      const resolved = typeof value === 'string' ? value : (value['en'] ?? Object.values(value)[0] ?? key)
      namespaces.get('_root')!.set(key, resolved)
    } else {
      const ns = key.slice(0, dotIndex)
      const rest = key.slice(dotIndex + 1)
      if (!namespaces.has(ns)) namespaces.set(ns, new Map())
      const resolved = typeof value === 'string' ? value : (value['en'] ?? Object.values(value)[0] ?? key)
      namespaces.get(ns)!.set(rest, resolved)
    }
  }

  const lines: string[] = []

  for (const [ns, keys] of namespaces) {
    if (ns === '_root') {
      for (const [k, v] of keys) {
        lines.push(`  public static let ${toCamel(k)} = NSLocalizedString("${k}", comment: "${v}")`)
      }
    } else {
      const enumName = ns.charAt(0).toUpperCase() + ns.slice(1)
      lines.push(`  public enum ${enumName} {`)
      for (const [k, v] of keys) {
        const fullKey = `${ns}.${k}`
        lines.push(`    public static let ${toCamel(k)} = NSLocalizedString("${fullKey}", comment: "${v}")`)
      }
      lines.push(`  }`)
    }
  }

  return lines.join('\n')
}

function toCamel(key: string): string {
  return key.replace(/[._]([a-zA-Z])/g, (_, c: string) => c.toUpperCase())
}
