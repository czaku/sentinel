/**
 * Google (Kotlin) model generator.
 * Reads sentinel/schemas/models/*.json → generates Kotlin data classes and enums.
 */
import fs from 'fs'
import path from 'path'
import type { ResolvedConfig, ModelSchema } from '../../../config/types.js'
import { writeFile, generatedHeader, hashFile } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'
import {
  loadModels, toKotlinType, toKotlinEnumCase, toKotlinDefault,
} from '../shared/model-parser.js'

export function generateGoogleModels(config: ResolvedConfig): void {
  const platform = config.platforms.google
  if (!platform?.output?.models) return

  const models = loadModels(config.modelsDir)
  const googleModels = models.filter(m => m.platforms.includes('google'))

  if (googleModels.length === 0) {
    log.dim('Google models — no models declared for google platform')
    return
  }

  const pkg = derivePackage(platform.output.models)

  const allFiles = googleModels.map(m => path.join(config.modelsDir, `${m.id}.json`))
  const headerHash = allFiles.length > 0 && fs.existsSync(allFiles[0])
    ? hashFile(allFiles[0])
    : undefined

  const blocks: string[] = []
  for (const model of googleModels) {
    blocks.push(generateKotlinModel(model))
  }

  const output = [
    generatedHeader('sentinel/generators/google/models', 'sentinel/schemas/models/', headerHash),
    `package ${pkg}`,
    ``,
    `import kotlinx.serialization.SerialName`,
    `import kotlinx.serialization.Serializable`,
    ``,
    `@Suppress("unused")`,
    blocks.join('\n\n'),
  ].join('\n')

  writeFile(platform.output.models, output)
  log.success(`Google models → ${platform.output.models}`)
}

function generateKotlinModel(model: ModelSchema): string {
  if (model.isEnum) {
    return generateKotlinEnum(model)
  }
  return generateKotlinDataClass(model)
}

function generateKotlinEnum(model: ModelSchema): string {
  const lines: string[] = []
  if (model.description) {
    lines.push(`/** ${model.description} */`)
  }
  lines.push(`@Serializable`)
  lines.push(`enum class ${model.name}(val value: String) {`)

  const values = model.enumValues ?? []
  values.forEach((v, i) => {
    if (v.description) lines.push(`    /** ${v.description} */`)
    const enumCase = toKotlinEnumCase(v.name)
    const suffix = i < values.length - 1 ? ',' : ';'
    if (enumCase !== v.rawValue.toUpperCase()) {
      lines.push(`    @SerialName("${v.rawValue}") ${enumCase}("${v.rawValue}")${suffix}`)
    } else {
      lines.push(`    ${enumCase}("${v.rawValue}")${suffix}`)
    }
  })
  lines.push(`}`)
  return lines.join('\n')
}

function generateKotlinDataClass(model: ModelSchema): string {
  const lines: string[] = []
  if (model.description) {
    lines.push(`/** ${model.description} */`)
  }
  lines.push(`@Serializable`)

  const fields = model.fields ?? []
  if (fields.length === 0) {
    lines.push(`data class ${model.name}(`)
    lines.push(`)`)
  } else {
    lines.push(`data class ${model.name}(`)
    fields.forEach((field, i) => {
      if (field.description) lines.push(`    /** ${field.description} */`)
      const kotlinType = toKotlinType(field)
      const defaultVal = toKotlinDefault(field)
      const suffix = i < fields.length - 1 ? ',' : ''
      // Use @SerialName if field name differs from JSON convention
      const def = defaultVal !== null
        ? ` = ${defaultVal}`
        : field.optional
          ? ' = null'
          : ''
      lines.push(`    val ${field.name}: ${kotlinType}${def}${suffix}`)
    })
    lines.push(`)`)
  }
  return lines.join('\n')
}

function derivePackage(outputPath: string): string {
  const match = outputPath.match(/kotlin[/\\](.+)[/\\][^/\\]+\.kt$/)
  if (!match) return 'com.app.models'
  return match[1].replace(/[/\\]/g, '.')
}
