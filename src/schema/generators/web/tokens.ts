import path from 'path'
import type { TokensSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, parseDimension, hashFile } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateWebTokens(config: ResolvedConfig): void {
  const platform = config.platforms.web ?? config.platforms['web-admin']
  if (!platform?.output?.tokens) return

  const tokensPath = path.join(config.designDir, 'tokens.json')
  const tokens = readJSON<TokensSchema>(tokensPath)

  const output = [
    generatedHeader('sentinel/generators/web/tokens', 'sentinel/schemas/design/tokens.json', hashFile(tokensPath)),
    generateCSSVariables(tokens),
    ``,
    generateTSExport(tokens),
  ].join('\n')

  writeFile(platform.output.tokens, output)
  log.success(`Web tokens → ${platform.output.tokens}`)
}

function generateCSSVariables(tokens: TokensSchema): string {
  const vars: string[] = []

  function walkColors(obj: Record<string, unknown>, prefix: string): void {
    for (const [key, value] of Object.entries(obj)) {
      const varName = `${prefix}-${key}`
      if (typeof value === 'object' && value !== null && 'value' in value) {
        vars.push(`  --color-${varName}: ${(value as { value: string }).value};`)
      } else if (typeof value === 'object' && value !== null) {
        walkColors(value as Record<string, unknown>, varName)
      }
    }
  }

  walkColors(tokens.colors as Record<string, unknown>, '')

  const spacing = tokens.spacing as Record<string, { value: string }>
  for (const [key, val] of Object.entries(spacing)) {
    vars.push(`  --spacing-${key}: ${val.value};`)
  }

  const typo = tokens.typography as Record<string, unknown>
  if ('fontSizes' in typo) {
    for (const [key, val] of Object.entries(typo.fontSizes as Record<string, { value: string }>)) {
      vars.push(`  --font-size-${key}: ${val.value};`)
    }
  }

  if (tokens.borderRadius) {
    for (const [key, val] of Object.entries(tokens.borderRadius as Record<string, { value: string }>)) {
      const size = parseDimension(val.value)
      vars.push(`  --radius-${key}: ${isNaN(size) ? '9999px' : val.value};`)
    }
  }

  return [`:root {`, ...vars, `}`].join('\n')
}

function generateTSExport(tokens: TokensSchema): string {
  const lines: string[] = [
    `export const tokens = {`,
    `  colors: ${JSON.stringify(flattenTokens(tokens.colors as Record<string, unknown>), null, 2)
      .split('\n').map((l, i) => i === 0 ? l : `  ${l}`).join('\n')},`,
    `  spacing: ${JSON.stringify(flattenTokens(tokens.spacing as Record<string, unknown>), null, 2)
      .split('\n').map((l, i) => i === 0 ? l : `  ${l}`).join('\n')},`,
    `} as const`,
    ``,
    `export type Tokens = typeof tokens`,
  ]
  return lines.join('\n')
}

function flattenTokens(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && 'value' in value) {
      result[fullKey] = (value as { value: string }).value
    } else if (typeof value === 'object' && value !== null) {
      Object.assign(result, flattenTokens(value as Record<string, unknown>, fullKey))
    }
  }
  return result
}
