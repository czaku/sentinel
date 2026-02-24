/**
 * Model schema parser and type mapper.
 * Shared between Apple (Swift) and Google (Kotlin) model generators.
 */
import fs from 'fs'
import path from 'path'
import type { ModelSchema, ModelFieldSchema } from '../../../config/types.js'

// Primitive type mapping
const SWIFT_TYPES: Record<string, string> = {
  String:  'String',
  Int:     'Int',
  Double:  'Double',
  Float:   'Float',
  Bool:    'Bool',
  Date:    'Date',
  UUID:    'UUID',
  URL:     'URL',
  Any:     'Any',
}

const KOTLIN_TYPES: Record<string, string> = {
  String:  'String',
  Int:     'Int',
  Double:  'Double',
  Float:   'Float',
  Bool:    'Boolean',
  Date:    'String',    // ISO-8601 string from API; swap for kotlinx.datetime.Instant if needed
  UUID:    'String',
  URL:     'String',
  Any:     'Any',
}

export function toSwiftType(field: ModelFieldSchema): string {
  const base = SWIFT_TYPES[field.type] ?? field.type  // unknown = another model name
  const arrayed = field.isArray ? `[${base}]` : base
  return field.optional ? `${arrayed}?` : arrayed
}

export function toKotlinType(field: ModelFieldSchema): string {
  const base = KOTLIN_TYPES[field.type] ?? field.type
  const arrayed = field.isArray ? `List<${base}>` : base
  return field.optional ? `${arrayed}?` : arrayed
}

export function needsSwiftFoundationImport(model: ModelSchema): boolean {
  if (model.isEnum) return false
  return model.fields?.some(f => ['Date', 'UUID', 'URL'].includes(f.type)) ?? false
}

// Convert enum value name to Swift convention (camelCase is already Swift-idiomatic)
export function toSwiftEnumCase(name: string): string {
  return name
}

// Convert enum value name to Kotlin convention (SCREAMING_SNAKE_CASE)
export function toKotlinEnumCase(name: string): string {
  return name.replace(/([A-Z])/g, '_$1').toUpperCase()
}

export function loadModels(modelsDir: string): ModelSchema[] {
  if (!fs.existsSync(modelsDir)) return []

  const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.json'))
  return files.map(file => {
    const raw = fs.readFileSync(path.join(modelsDir, file), 'utf-8')
    return JSON.parse(raw) as ModelSchema
  })
}

export function toSwiftDefault(field: ModelFieldSchema): string | null {
  if (field.default === undefined) return null
  if (field.type === 'String') return `"${field.default}"`
  if (field.type === 'Bool') return field.default ? 'true' : 'false'
  return String(field.default)
}

export function toKotlinDefault(field: ModelFieldSchema): string | null {
  if (field.default === undefined) return null
  if (field.type === 'String') return `"${field.default}"`
  if (field.type === 'Bool') return field.default ? 'true' : 'false'
  return String(field.default)
}
