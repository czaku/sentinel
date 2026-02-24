import path from 'path'
import type { TokensSchema, ResolvedConfig } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, parseDimension } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateGoogleTokens(config: ResolvedConfig): void {
  const platform = config.platforms.google
  if (!platform?.output?.tokens) return

  const tokensPath = path.join(config.designDir, 'tokens.json')
  const tokens = readJSON<TokensSchema>(tokensPath)

  const pkg = derivePackage(platform.output.tokens)
  const name = projectName(config)

  const output = [
    generatedHeader('sentinel/generators/google/tokens', 'sentinel/schemas/design/tokens.json'),
    `package ${pkg}`,
    ``,
    `import androidx.compose.ui.graphics.Color`,
    `import androidx.compose.ui.unit.dp`,
    `import androidx.compose.ui.unit.sp`,
    ``,
    `@Suppress("MemberVisibilityCanBePrivate", "unused")`,
    `object ${name}Tokens {`,
    generateColors(tokens),
    generateTypography(tokens),
    generateSpacing(tokens),
    generateBorderRadius(tokens),
    generateAnimation(tokens),
    `}`,
  ].join('\n')

  writeFile(platform.output.tokens, output)
  log.success(`Google tokens → ${platform.output.tokens}`)
}

function projectName(config: ResolvedConfig): string {
  return config.project.charAt(0).toUpperCase() + config.project.slice(1)
}

function derivePackage(outputPath: string): string {
  // Extract package from path: .../kotlin/com/fitkind/design/... → com.fitkind.design
  const match = outputPath.match(/kotlin[/\\](.+)[/\\][^/\\]+\.kt$/)
  if (!match) return 'com.app.design'
  return match[1].replace(/[/\\]/g, '.')
}

function hexToLong(hex: string): string {
  const clean = hex.replace('#', '')
  const full = clean.length === 6 ? `FF${clean}` : clean
  return `0xFF${full.toUpperCase()}`
}

function generateColors(tokens: TokensSchema): string {
  const lines: string[] = ['    object Colors {']

  function walk(obj: Record<string, unknown>, indent: number): string[] {
    const result: string[] = []
    const pad = '    '.repeat(indent)

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null && !('value' in value)) {
        const objName = key.charAt(0).toUpperCase() + key.slice(1)
        result.push(`${pad}object ${objName} {`)
        result.push(...walk(value as Record<string, unknown>, indent + 1))
        result.push(`${pad}}`)
      } else if (typeof value === 'object' && value !== null && 'value' in value) {
        const v = (value as { value: string }).value
        if (v.startsWith('#')) {
          result.push(`${pad}val ${key} = Color(${hexToLong(v)})`)
        }
      }
    }
    return result
  }

  lines.push(...walk(tokens.colors as Record<string, unknown>, 2))
  lines.push('    }')
  return lines.join('\n')
}

function generateTypography(tokens: TokensSchema): string {
  const lines: string[] = ['    object Typography {']
  const typo = tokens.typography as Record<string, unknown>

  if ('fontSizes' in typo) {
    lines.push('        object FontSize {')
    for (const [key, val] of Object.entries(typo.fontSizes as Record<string, { value: string }>)) {
      const size = parseDimension(val.value)
      lines.push(`            val ${key} = ${size}.sp`)
    }
    lines.push('        }')
  }

  if ('lineHeights' in typo) {
    lines.push('        object LineHeight {')
    for (const [key, val] of Object.entries(typo.lineHeights as Record<string, { value: string }>)) {
      lines.push(`            val ${key} = ${val.value}f`)
    }
    lines.push('        }')
  }

  lines.push('    }')
  return lines.join('\n')
}

function generateSpacing(tokens: TokensSchema): string {
  const lines: string[] = ['    object Spacing {']
  for (const [key, val] of Object.entries(tokens.spacing as Record<string, { value: string }>)) {
    const size = parseDimension(val.value)
    const safeName = /^\d/.test(key) ? `s${key}` : key
    lines.push(`        val ${safeName} = ${size}.dp`)
  }
  lines.push('    }')
  return lines.join('\n')
}

function generateBorderRadius(tokens: TokensSchema): string {
  if (!tokens.borderRadius) return ''
  const lines: string[] = ['    object CornerRadius {']
  for (const [key, val] of Object.entries(tokens.borderRadius as Record<string, { value: string }>)) {
    const size = parseDimension(val.value)
    const v = isNaN(size) ? '999' : String(size)
    lines.push(`        val ${key} = ${v}.dp`)
  }
  lines.push('    }')
  return lines.join('\n')
}

function generateAnimation(tokens: TokensSchema): string {
  if (!tokens.animation) return ''
  const lines: string[] = ['    object Animation {']
  const anim = tokens.animation as Record<string, unknown>

  if ('duration' in anim) {
    lines.push('        object Duration {')
    for (const [key, val] of Object.entries(anim.duration as Record<string, { value: string }>)) {
      const ms = parseDimension(val.value)
      lines.push(`            val ${key} = ${ms}`)
    }
    lines.push('        }')
  }

  lines.push('    }')
  return lines.join('\n')
}
