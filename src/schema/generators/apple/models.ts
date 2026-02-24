/**
 * Apple (Swift) model generator.
 * Reads sentinel/schemas/models/*.json → generates Swift structs and enums.
 */
import fs from 'fs'
import path from 'path'
import type { ResolvedConfig, ModelSchema } from '../../../config/types.js'
import { writeFile, generatedHeader, hashFile } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'
import {
  loadModels, toSwiftType, toSwiftEnumCase, toSwiftDefault, needsSwiftFoundationImport,
} from '../shared/model-parser.js'

export function generateAppleModels(config: ResolvedConfig): void {
  const platform = config.platforms.apple
  if (!platform?.output?.models) return

  const models = loadModels(config.modelsDir)
  const appleModels = models.filter(m => m.platforms.includes('apple'))

  if (appleModels.length === 0) {
    log.dim('Apple models — no models declared for apple platform')
    return
  }

  // Generate one file with all models
  const schemaDir = config.modelsDir
  // Use a combined hash of all model files for staleness tracking
  const allFiles = appleModels.map(m =>
    path.join(schemaDir, `${m.id}.json`)
  )
  // Use first file hash for header (staleness tracks individual files separately)
  const headerHash = allFiles.length > 0 && fs.existsSync(allFiles[0])
    ? hashFile(allFiles[0])
    : undefined

  const imports = new Set(['Foundation'])
  // SwiftUI not needed for plain models; Codable conformance needs Foundation

  const blocks: string[] = []
  for (const model of appleModels) {
    if (needsSwiftFoundationImport(model)) {
      imports.add('Foundation')
    }
    blocks.push(generateSwiftModel(model))
  }

  const output = [
    generatedHeader('sentinel/generators/apple/models', 'sentinel/schemas/models/', headerHash),
    [...imports].map(i => `import ${i}`).join('\n'),
    ``,
    `// swiftlint:disable all`,
    blocks.join('\n\n'),
    `// swiftlint:enable all`,
  ].join('\n')

  writeFile(platform.output.models, output)
  log.success(`Apple models → ${platform.output.models}`)
}

function generateSwiftModel(model: ModelSchema): string {
  if (model.isEnum) {
    return generateSwiftEnum(model)
  }
  return generateSwiftStruct(model)
}

function generateSwiftEnum(model: ModelSchema): string {
  const lines: string[] = []
  if (model.description) {
    lines.push(`/// ${model.description}`)
  }
  lines.push(`public enum ${model.name}: String, Codable, CaseIterable {`)
  for (const v of model.enumValues ?? []) {
    if (v.description) lines.push(`    /// ${v.description}`)
    const caseName = toSwiftEnumCase(v.name)
    if (caseName === v.rawValue) {
      lines.push(`    case ${caseName}`)
    } else {
      lines.push(`    case ${caseName} = "${v.rawValue}"`)
    }
  }
  lines.push(`}`)
  return lines.join('\n')
}

function generateSwiftStruct(model: ModelSchema): string {
  const lines: string[] = []
  if (model.description) {
    lines.push(`/// ${model.description}`)
  }
  lines.push(`public struct ${model.name}: Codable, Identifiable {`)

  for (const field of model.fields ?? []) {
    if (field.description) {
      lines.push(`    /// ${field.description}`)
    }
    const swiftType = toSwiftType(field)
    const defaultVal = toSwiftDefault(field)
    if (defaultVal !== null) {
      lines.push(`    public var ${field.name}: ${swiftType} = ${defaultVal}`)
    } else {
      lines.push(`    public var ${field.name}: ${swiftType}`)
    }
  }

  // Generate memberwise init if any fields exist
  if ((model.fields ?? []).length > 0) {
    lines.push(``)
    lines.push(`    public init(`)
    const params = (model.fields ?? []).map((field, i, arr) => {
      const swiftType = toSwiftType(field)
      const defaultVal = toSwiftDefault(field)
      const suffix = i < arr.length - 1 ? ',' : ''
      const def = defaultVal !== null ? ` = ${defaultVal}` : field.optional ? ' = nil' : ''
      return `        ${field.name}: ${swiftType}${def}${suffix}`
    })
    lines.push(...params)
    lines.push(`    ) {`)
    for (const field of model.fields ?? []) {
      lines.push(`        self.${field.name} = ${field.name}`)
    }
    lines.push(`    }`)
  }

  lines.push(`}`)
  return lines.join('\n')
}
