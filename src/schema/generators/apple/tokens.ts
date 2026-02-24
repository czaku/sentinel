import path from 'path'
import type { TokensSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, parseDimension } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateAppleTokens(config: ResolvedConfig): void {
  const platform = config.platforms.apple
  if (!platform?.output?.tokens) return

  const tokensPath = path.join(config.designDir, 'tokens.json')
  const tokens = readJSON<TokensSchema>(tokensPath)

  const output = [
    generatedHeader('sentinel/generators/apple/tokens', 'sentinel/schemas/design/tokens.json'),
    `import SwiftUI`,
    ``,
    `// swiftlint:disable all`,
    `public enum ${projectName(config)}Tokens {`,
    generateColors(tokens),
    generateTypography(tokens),
    generateSpacing(tokens),
    generateBorderRadius(tokens),
    generateAnimation(tokens),
    `}`,
    `// swiftlint:enable all`,
  ].join('\n')

  writeFile(platform.output.tokens, output)
  log.success(`Apple tokens → ${platform.output.tokens}`)
}

function projectName(config: ResolvedConfig): string {
  return config.project.charAt(0).toUpperCase() + config.project.slice(1)
}

function generateColors(tokens: TokensSchema): string {
  const lines: string[] = ['  public enum Colors {']

  function walk(obj: Record<string, unknown>, indent: number, path: string[]): string[] {
    const result: string[] = []
    const pad = '  '.repeat(indent)

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !('value' in value)) {
        const enumName = key.charAt(0).toUpperCase() + key.slice(1)
        result.push(`${pad}public enum ${enumName} {`)
        result.push(...walk(value as Record<string, unknown>, indent + 1, [...path, key]))
        result.push(`${pad}}`)
      } else if (typeof value === 'object' && value !== null && 'value' in value) {
        const v = (value as { value: string }).value
        if (v.startsWith('#') || v.startsWith('rgb') || v.startsWith('rgba')) {
          result.push(`${pad}public static let ${key} = Color(hex: "${v}")`)
        }
      }
    }
    return result
  }

  lines.push(...walk(tokens.colors as Record<string, unknown>, 2, []))
  lines.push('  }')
  return lines.join('\n')
}

function generateTypography(tokens: TokensSchema): string {
  const lines: string[] = ['  public enum Typography {']
  const typo = tokens.typography as Record<string, unknown>

  if ('fontSizes' in typo) {
    lines.push('    public enum FontSize {')
    for (const [key, val] of Object.entries(typo.fontSizes as Record<string, { value: string }>)) {
      const size = parseDimension(val.value)
      lines.push(`      public static let ${key}: CGFloat = ${size}`)
    }
    lines.push('    }')
  }

  if ('fontWeights' in typo) {
    lines.push('    public enum FontWeight {')
    for (const [key, val] of Object.entries(typo.fontWeights as Record<string, { value: string }>)) {
      const weight = val.value
      lines.push(`      public static let ${key}: Font.Weight = .init(rawValue: ${weight})`)
    }
    lines.push('    }')
  }

  if ('lineHeights' in typo) {
    lines.push('    public enum LineHeight {')
    for (const [key, val] of Object.entries(typo.lineHeights as Record<string, { value: string }>)) {
      lines.push(`      public static let ${key}: CGFloat = ${val.value}`)
    }
    lines.push('    }')
  }

  lines.push('  }')
  return lines.join('\n')
}

function generateSpacing(tokens: TokensSchema): string {
  const lines: string[] = ['  public enum Spacing {']
  for (const [key, val] of Object.entries(tokens.spacing as Record<string, { value: string }>)) {
    const size = parseDimension(val.value)
    const safeName = /^\d/.test(key) ? `s${key}` : key
    lines.push(`    public static let ${safeName}: CGFloat = ${size}`)
  }
  lines.push('  }')
  return lines.join('\n')
}

function generateBorderRadius(tokens: TokensSchema): string {
  if (!tokens.borderRadius) return ''
  const lines: string[] = ['  public enum CornerRadius {']
  for (const [key, val] of Object.entries(tokens.borderRadius as Record<string, { value: string }>)) {
    const size = parseDimension(val.value)
    const v = isNaN(size) ? '999' : String(size)
    lines.push(`    public static let ${key}: CGFloat = ${v}`)
  }
  lines.push('  }')
  return lines.join('\n')
}

function generateAnimation(tokens: TokensSchema): string {
  if (!tokens.animation) return ''
  const lines: string[] = ['  public enum Animation {']
  const anim = tokens.animation as Record<string, unknown>

  if ('duration' in anim) {
    lines.push('    public enum Duration {')
    for (const [key, val] of Object.entries(anim.duration as Record<string, { value: string }>)) {
      const ms = parseDimension(val.value)
      lines.push(`      public static let ${key}: Double = ${ms / 1000}`)
    }
    lines.push('    }')
  }

  lines.push('  }')
  return lines.join('\n')
}
