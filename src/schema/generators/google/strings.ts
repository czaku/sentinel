import path from 'path'
import type { StringsSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, xmlGeneratedHeader, toAndroidKey } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateGoogleStrings(config: ResolvedConfig): void {
  const platform = config.platforms.google
  if (!platform?.output?.strings) return

  const stringsPath = path.join(config.designDir, 'strings.json')
  const schema = readJSON<StringsSchema>(stringsPath)

  const entries = Object.entries(schema.strings).map(([key, value]) => {
    const resolved = typeof value === 'string'
      ? value
      : (value['en'] ?? Object.values(value)[0] ?? key)
    const androidKey = toAndroidKey(key)
    // Escape XML special chars and Android string resource chars
    const escaped = String(resolved)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
    return `    <string name="${androidKey}">${escaped}</string>`
  })

  const output = [
    xmlGeneratedHeader('sentinel/schemas/design/strings.json'),
    `<resources>`,
    ...entries,
    `</resources>`,
  ].join('\n')

  writeFile(platform.output.strings, output)
  log.success(`Google strings → ${platform.output.strings}`)
}
