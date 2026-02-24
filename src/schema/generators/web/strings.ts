import path from 'path'
import type { StringsSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, hashFile } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateWebStrings(config: ResolvedConfig): void {
  const platform = config.platforms.web ?? config.platforms['web-admin']
  if (!platform?.output?.strings) return

  const stringsPath = path.join(config.designDir, 'strings.json')
  const schema = readJSON<StringsSchema>(stringsPath)

  const nested = buildNestedObject(schema.strings)

  const output = [
    generatedHeader('sentinel/generators/web/strings', 'sentinel/schemas/design/strings.json', hashFile(stringsPath)),
    `// Supports multiple locales — add locale keys to strings.json`,
    ``,
    `export const strings = ${JSON.stringify(nested, null, 2)} as const`,
    ``,
    `export type Strings = typeof strings`,
    `export type StringKey = keyof typeof strings`,
  ].join('\n')

  writeFile(platform.output.strings, output)
  log.success(`Web strings → ${platform.output.strings}`)
}

function buildNestedObject(
  strings: Record<string, string | Record<string, string>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(strings)) {
    const parts = key.split('.')
    let cursor = result
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cursor)) cursor[parts[i]] = {}
      cursor = cursor[parts[i]] as Record<string, unknown>
    }
    const leaf = parts[parts.length - 1]
    cursor[leaf] = typeof value === 'string' ? value : (value['en'] ?? Object.values(value)[0] ?? key)
  }

  return result
}
