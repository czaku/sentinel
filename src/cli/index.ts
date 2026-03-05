/**
 * Sentinel CLI — Cross-platform schema validation and code generation.
 *
 * Enforces sync between iOS (Swift), Android (Kotlin), Backend (TypeScript/NestJS),
 * and Web frontends. Reads all output paths from sentinel.yaml — works for any project.
 *
 * Commands:
 *   schema:validate  — Validate schemas, detect generated-file drift, warn on unused keys.
 *   schema:generate  — Generate all platform files from schemas.
 *   contracts        — Validate API endpoint contracts.
 *   all              — validate then generate.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Repo root detection
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'sentinel.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('sentinel: could not find sentinel.yaml — run from within the project repo.');
}

const ROOT = findRepoRoot();
const SCHEMAS_DIR = join(ROOT, 'sentinel', 'schemas');

// ---------------------------------------------------------------------------
// sentinel.yaml config (multi-project aware)
// ---------------------------------------------------------------------------

interface PlatformOutput {
  tokens?: string;
  strings?: string;
  flags?: string;
  models?: string;
  endpoints?: string;
}

interface PlatformConfig {
  path?: string;
  language?: string;
  framework?: string;
  output?: PlatformOutput;
}

interface SentinelConfig {
  project: string;
  platforms: Record<string, PlatformConfig>;
}

/** Minimal sentinel.yaml parser — handles the fixed indentation format we use. */
function loadSentinelConfig(): SentinelConfig {
  const yamlPath = join(ROOT, 'sentinel.yaml');
  if (!existsSync(yamlPath)) throw new Error('sentinel.yaml not found at repo root');

  const config: SentinelConfig = { project: '', platforms: {} };
  let section: string | null = null;
  let platform: string | null = null;
  let inOutput = false;

  for (const raw of readFileSync(yamlPath, 'utf8').split('\n')) {
    const trimmed = raw.trimEnd();
    if (!trimmed || trimmed.trimStart().startsWith('#')) continue;

    const indent = raw.search(/\S/);
    const content = trimmed.trim();

    if (indent === 0) {
      if (content.startsWith('project:'))
        config.project = content.replace('project:', '').trim().replace(/^["']|["']$/g, '');
      section = content.endsWith(':') ? content.slice(0, -1) : null;
      platform = null;
      inOutput = false;
      continue;
    }

    if (section === 'platforms' && indent === 2 && content.endsWith(':')) {
      platform = content.slice(0, -1);
      config.platforms[platform] = {};
      inOutput = false;
      continue;
    }

    if (platform && indent === 4) {
      if (content === 'output:') { inOutput = true; continue; }
      inOutput = false;
      const m = content.match(/^(\w+):\s*(.+)$/);
      if (m) (config.platforms[platform] as Record<string, string>)[m[1]] = m[2].replace(/^["']|["']$/g, '');
      continue;
    }

    if (platform && inOutput && indent === 6) {
      const m = content.match(/^(\w+):\s*(.+)$/);
      if (m) {
        if (!config.platforms[platform].output) config.platforms[platform].output = {};
        const val = m[2].trim().replace(/^["']|["']$/g, '').replace(/^\.\//, '');
        (config.platforms[platform].output as Record<string, string>)[m[1]] = val;
      }
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

interface SchemaFile {
  filename: string;
  content: Record<string, unknown>;
}

function loadDir(subdir: string): SchemaFile[] {
  const dir = join(SCHEMAS_DIR, subdir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      filename: f,
      content: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>,
    }));
}

function loadAll() {
  return {
    design: loadDir('design'),
    features: loadDir('features'),
    models: loadDir('models'),
    platform: loadDir('platform'),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseValue(str: string): number {
  return parseFloat(String(str).replace(/[a-zA-Z%]+$/, ''));
}

function hexToRgbFloat(hex: string): { r: string; g: string; b: string } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r: (r / 255).toFixed(3) + 'f', g: (g / 255).toFixed(3) + 'f', b: (b / 255).toFixed(3) + 'f' };
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toPascalCase(str: string): string {
  const cc = toCamelCase(str);
  return cc.charAt(0).toUpperCase() + cc.slice(1);
}

function writeFile(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  console.log(`  wrote ${filePath.replace(ROOT + '/', '')}`);
}

const GENERATED_HEADER = (source: string) =>
  `// GENERATED FILE — DO NOT EDIT\n// Run \`npm run schema:generate\` from the repo root to regenerate.\n// Source: ${source}\n`;

// ---------------------------------------------------------------------------
// schema:validate
// ---------------------------------------------------------------------------

function cmdValidate(): void {
  const all = loadAll();
  const errors: string[] = [];
  const warnings: string[] = [];

  // Build reference sets for cross-validation
  const stringsSchema = all.design.find((s) => s.content['type'] === 'strings')?.content;
  const flagsSchema = all.platform.find((s) => s.content['type'] === 'feature-flags')?.content;
  const allStringKeys = new Set(Object.keys((stringsSchema?.['strings'] as Record<string, string>) ?? {}));
  const allFlagKeys = new Set(((flagsSchema?.['flags'] as { key: string }[]) ?? []).map((f) => f.key));
  const allModelNames = new Set(all.models.map((s) => s.content['name'] as string).filter(Boolean));

  // Track what's actually referenced (for unused-key detection)
  const referencedStringKeys = new Set<string>();
  const referencedModelNames = new Set<string>();

  const check = (filename: string, schema: Record<string, unknown>) => {
    if (!schema['$sentinel']) errors.push(`${filename}: missing '$sentinel' field`);
    if (!schema['type']) errors.push(`${filename}: missing 'type' field`);

    switch (schema['type']) {
      case 'tokens':
        if (!schema['colors']) errors.push(`${filename}: missing 'colors'`);
        if (!schema['typography']) errors.push(`${filename}: missing 'typography'`);
        if (!schema['spacing']) errors.push(`${filename}: missing 'spacing'`);
        break;

      case 'strings':
        if (!Array.isArray(schema['locales']) || !(schema['locales'] as unknown[]).length)
          errors.push(`${filename}: missing 'locales' array`);
        if (typeof schema['strings'] !== 'object')
          errors.push(`${filename}: missing 'strings' object`);
        break;

      case 'feature-flags':
        if (!Array.isArray(schema['flags']))
          errors.push(`${filename}: missing 'flags' array`);
        break;

      case 'navigation':
        if (!Array.isArray(schema['tabs'])) errors.push(`${filename}: missing 'tabs' array`);
        if (!Array.isArray(schema['routes'])) errors.push(`${filename}: missing 'routes' array`);
        break;

      case 'feature':
        if (!schema['id']) errors.push(`${filename}: missing 'id'`);
        if (!schema['name']) errors.push(`${filename}: missing 'name'`);
        if (!schema['milestone']) errors.push(`${filename}: missing 'milestone'`);
        for (const m of (schema['models'] as string[]) ?? []) {
          if (!allModelNames.has(m)) errors.push(`${filename}: references unknown model '${m}'`);
          else referencedModelNames.add(m);
        }
        for (const f of (schema['flags'] as string[]) ?? []) {
          if (!allFlagKeys.has(f)) errors.push(`${filename}: references unknown flag '${f}'`);
        }
        for (const sk of (schema['strings'] as string[]) ?? []) {
          if (!allStringKeys.has(sk)) errors.push(`${filename}: references unknown string key '${sk}'`);
          else referencedStringKeys.add(sk);
        }
        break;

      case 'model':
        if (!schema['id']) errors.push(`${filename}: missing 'id'`);
        if (!schema['name']) errors.push(`${filename}: missing 'name'`);
        if (!schema['isEnum'] && !Array.isArray(schema['fields']))
          errors.push(`${filename}: must have 'isEnum: true' or 'fields' array`);
        if (schema['isEnum'] && !Array.isArray(schema['enumValues']))
          errors.push(`${filename}: enum model missing 'enumValues'`);
        break;

      case 'endpoints': {
        if (!schema['id']) errors.push(`${filename}: missing 'id'`);
        if (!Array.isArray(schema['endpoints'])) {
          errors.push(`${filename}: missing 'endpoints' array`);
          break;
        }
        const eps = schema['endpoints'] as Array<Record<string, unknown>>;
        for (const ep of eps) {
          if (!ep['id']) errors.push(`${filename}: endpoint missing 'id'`);
          if (!ep['method']) errors.push(`${filename}: endpoint '${ep['id']}' missing 'method'`);
          if (!ep['path']) errors.push(`${filename}: endpoint '${ep['id']}' missing 'path'`);
          // Validate response model reference
          const resp = ep['response'] as Record<string, unknown> | undefined;
          if (resp?.['type'] && typeof resp['type'] === 'string' && !isPrimitiveType(resp['type'])) {
            if (!allModelNames.has(resp['type']))
              errors.push(`${filename}: endpoint '${ep['id']}' response type '${resp['type']}' is not a known model`);
            else referencedModelNames.add(resp['type'] as string);
          }
          // Validate body model reference
          const body = ep['body'] as Record<string, unknown> | undefined;
          if (body?.['type'] && typeof body['type'] === 'string' && !isPrimitiveType(body['type'])) {
            if (!allModelNames.has(body['type']))
              errors.push(`${filename}: endpoint '${ep['id']}' body type '${body['type']}' is not a known model`);
            else referencedModelNames.add(body['type'] as string);
          }
        }
        break;
      }

      case 'mock-config':
        if (!Array.isArray(schema['fixtures']))
          errors.push(`${filename}: missing 'fixtures' array`);
        break;

      default:
        break;
    }
  };

  for (const { filename, content } of [...all.design, ...all.features, ...all.models, ...all.platform]) {
    check(filename, content);
  }

  // ── Unused string keys ─────────────────────────────────────────────────────
  for (const key of allStringKeys) {
    if (!referencedStringKeys.has(key))
      warnings.push(`strings.json: key '${key}' defined but not referenced by any feature schema`);
  }

  // ── Unreferenced models ───────────────────────────────────────────────────
  for (const name of allModelNames) {
    if (!referencedModelNames.has(name))
      warnings.push(`model '${name}' not referenced by any feature or endpoint schema`);
  }

  // ── Generated-file drift detection ────────────────────────────────────────
  const driftErrors = detectDrift(all);
  errors.push(...driftErrors);

  // ── Mock fixture warnings ─────────────────────────────────────────────────
  validateMocks(all, warnings);

  const total = all.design.length + all.features.length + all.models.length + all.platform.length;

  if (warnings.length > 0) {
    console.warn(`\n  Warnings (${warnings.length}):`);
    warnings.forEach((w) => console.warn(`    ⚠  ${w}`));
  }

  if (errors.length > 0) {
    console.error(`\n✗ Schema validation failed:\n`);
    errors.forEach((e) => console.error(`  • ${e}`));
    console.error(`\n${errors.length} error(s) in ${total} schemas.\n`);
    process.exit(1);
  } else {
    console.log(`\n✓ All ${total} schemas valid.`);
  }
}

function isPrimitiveType(t: string): boolean {
  return ['String', 'Int', 'Double', 'Float', 'Bool', 'Date', 'UUID', 'Void'].includes(t);
}

// ---------------------------------------------------------------------------
// Generated-file drift detection
// ---------------------------------------------------------------------------

function detectDrift(all: ReturnType<typeof loadAll>): string[] {
  const errors: string[] = [];
  let config: SentinelConfig;
  try { config = loadSentinelConfig(); } catch { return []; }

  const tokensSchema = all.design.find((s) => s.content['type'] === 'tokens')?.content;
  const stringsSchema = all.design.find((s) => s.content['type'] === 'strings')?.content;
  const flagsSchema = all.platform.find((s) => s.content['type'] === 'feature-flags')?.content;
  if (!tokensSchema || !stringsSchema || !flagsSchema) return [];

  const endpointSchemas = all.features.filter((s) => s.content['type'] === 'endpoints');

  const checkFile = (relPath: string | undefined, expected: string, label: string) => {
    if (!relPath) return;
    const full = join(ROOT, relPath);
    if (!existsSync(full)) return; // file not generated yet — not a drift error
    const onDisk = readFileSync(full, 'utf8');
    if (onDisk !== expected)
      errors.push(`drift: ${relPath} is out of sync — run npm run schema:generate`);
  };

  for (const [platform, cfg] of Object.entries(config.platforms)) {
    const out = cfg.output ?? {};
    const lang = cfg.language ?? '';

    if (lang === 'swift') {
      checkFile(out.tokens, genSwiftTokens(tokensSchema), `${platform} tokens`);
      checkFile(out.strings, genSwiftStrings(stringsSchema), `${platform} strings`);
      checkFile(out.flags, genSwiftFlags(flagsSchema), `${platform} flags`);
      checkFile(out.models, genSwiftModels(all.models), `${platform} models`);
      if (out.endpoints && endpointSchemas.length > 0)
        checkFile(out.endpoints, genSwiftEndpoints(endpointSchemas), `${platform} endpoints`);
    } else if (lang === 'kotlin') {
      checkFile(out.tokens, genKotlinTokens(tokensSchema), `${platform} tokens`);
      checkFile(out.strings, genKotlinStrings(stringsSchema), `${platform} strings`);
      checkFile(out.flags, genKotlinFlags(flagsSchema), `${platform} flags`);
      checkFile(out.models, genKotlinModels(all.models), `${platform} models`);
      if (out.endpoints && endpointSchemas.length > 0)
        checkFile(out.endpoints, genKotlinEndpoints(endpointSchemas), `${platform} endpoints`);
    } else if (lang === 'typescript') {
      checkFile(out.tokens, genCssTokens(tokensSchema), `${platform} tokens`);
      checkFile(out.strings, genTsStrings(stringsSchema), `${platform} strings`);
      checkFile(out.flags, genTsFlags(flagsSchema), `${platform} flags`);
      if (out.endpoints && endpointSchemas.length > 0)
        checkFile(out.endpoints, genTsEndpoints(endpointSchemas), `${platform} endpoints`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Swift generators
// ---------------------------------------------------------------------------

function genSwiftTokens(tokens: Record<string, unknown>): string {
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/design/tokens.json'),
    'import SwiftUI',
    '',
    '// MARK: - Colours',
    '',
  ];

  const colors = tokens['colors'] as Record<string, Record<string, { value: string; description?: string }>>;
  for (const [group, entries] of Object.entries(colors)) {
    lines.push(`enum FKColor${toPascalCase(group)} {`);
    for (const [name, def] of Object.entries(entries)) {
      const comment = def.description ? `  // ${def.description}` : '';
      lines.push(`    static let ${name} = Color(hex: "${def.value}")${comment}`);
    }
    lines.push('}', '');
  }

  lines.push('// MARK: - Spacing', '', 'enum FKSpacing {');
  const spacing = tokens['spacing'] as Record<string, { value: string }>;
  for (const [k, v] of Object.entries(spacing)) {
    lines.push(`    static let ${k === '0' ? 's0' : `s${k}`}: CGFloat = ${parseValue(v.value)}`);
  }
  lines.push('}', '');

  lines.push('// MARK: - Border Radius', '', 'enum FKRadius {');
  const radii = tokens['borderRadius'] as Record<string, { value: string; description?: string }>;
  for (const [k, v] of Object.entries(radii)) {
    const comment = v.description ? `  // ${v.description}` : '';
    lines.push(`    static let ${k}: CGFloat = ${parseValue(v.value)}${comment}`);
  }
  lines.push('}', '');

  lines.push('// MARK: - Animation', '', 'enum FKAnimation {');
  const anim = ((tokens['animation'] as { duration: Record<string, { value: string; description?: string }> } | undefined)?.duration ?? {});
  for (const [k, v] of Object.entries(anim)) {
    const comment = v.description ? `  // ${v.description}` : '';
    lines.push(`    static let ${k}: Double = ${parseValue(v.value) / 1000}${comment}`);
  }
  lines.push('}', '');

  lines.push('// MARK: - Icon Sizes', '', 'enum FKIconSize {');
  const icons = (tokens['iconSizes'] ?? {}) as Record<string, { value: string }>;
  for (const [k, v] of Object.entries(icons)) {
    lines.push(`    static let ${k}: CGFloat = ${parseValue(v.value)}`);
  }
  lines.push('}', '');

  lines.push('// MARK: - Component Tokens', '', 'enum FKComponent {');
  const comp = (tokens['components'] ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(comp)) {
    if (typeof v === 'object' && v !== null && 'value' in v) {
      const val = parseValue((v as { value: string }).value);
      if (!isNaN(val)) {
        const comment = 'description' in v ? `  // ${(v as { description: string }).description}` : '';
        lines.push(`    static let ${k}: CGFloat = ${val}${comment}`);
      }
    } else if (typeof v === 'object' && v !== null) {
      for (const [subK, subV] of Object.entries(v as Record<string, { value: string }>)) {
        const val = parseValue(subV.value);
        if (!isNaN(val)) lines.push(`    static let ${k}${toPascalCase(subK)}: CGFloat = ${val}`);
      }
    }
  }
  lines.push('}', '');

  lines.push(
    '// MARK: - Hex Colour Initialiser', '',
    'private extension Color {',
    '    init(hex: String) {',
    '        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)',
    '        var int: UInt64 = 0',
    '        Scanner(string: hex).scanHexInt64(&int)',
    '        let a, r, g, b: UInt64',
    '        switch hex.count {',
    "        case 3:  (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)",
    "        case 6:  (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)",
    "        case 8:  (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)",
    "        default: (a, r, g, b) = (255, 0, 0, 0)",
    '        }',
    '        self.init(.sRGB, red: Double(r)/255, green: Double(g)/255, blue: Double(b)/255, opacity: Double(a)/255)',
    '    }',
    '}',
  );

  return lines.join('\n');
}

function genSwiftStrings(stringsSchema: Record<string, unknown>): string {
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/design/strings.json'),
    'import Foundation',
    '',
    '// swiftlint:disable identifier_name',
    '// Usage: L.Common.ok  L.Vault.startWorkout  etc.',
    'enum L {',
  ];

  const strings = stringsSchema['strings'] as Record<string, string>;
  const grouped = new Map<string, Array<{ subKey: string; fullKey: string; value: string }>>();

  for (const [key, value] of Object.entries(strings)) {
    const dot = key.indexOf('.');
    const ns = dot >= 0 ? key.substring(0, dot) : 'global';
    const subKey = dot >= 0 ? key.substring(dot + 1) : key;
    if (!grouped.has(ns)) grouped.set(ns, []);
    grouped.get(ns)!.push({ subKey, fullKey: key, value });
  }

  for (const [ns, entries] of grouped) {
    lines.push(`    enum ${toPascalCase(ns)} {`);
    for (const { subKey, fullKey, value } of entries) {
      const varName = subKey.split('.').reduce((acc, part, i) => (i === 0 ? part : acc + toPascalCase(part)), '');
      const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      lines.push(`        static var ${varName}: String { NSLocalizedString("${fullKey}", value: "${escaped}", comment: "") }`);
    }
    lines.push('    }');
  }

  lines.push('}');
  return lines.join('\n');
}

function genSwiftFlags(flagsSchema: Record<string, unknown>): string {
  const flags = flagsSchema['flags'] as Array<{ key: string; description: string; defaultEnabled: boolean }>;
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/platform/feature-flags.json'),
    '// Off = feature is completely hidden — no UI, no API calls.',
    'enum FeatureFlag: String, CaseIterable {',
  ];

  for (const f of flags) {
    lines.push(`    case ${toCamelCase(f.key.toLowerCase())} = "${f.key}"  // ${f.description}`);
  }

  lines.push('', '    var isEnabled: Bool {', '        switch self {');
  for (const f of flags) {
    lines.push(`        case .${toCamelCase(f.key.toLowerCase())}: return ${f.defaultEnabled}`);
  }
  lines.push('        }', '    }', '}');
  return lines.join('\n');
}

function swiftFieldType(type: string, isArray: boolean, optional: boolean): string {
  const map: Record<string, string> = { UUID: 'UUID', String: 'String', Int: 'Int', Double: 'Double', Bool: 'Bool', Date: 'Date', Float: 'Float' };
  let t = map[type] ?? type;
  if (isArray) t = `[${t}]`;
  if (optional) t = `${t}?`;
  return t;
}

function genSwiftModels(models: SchemaFile[]): string {
  const lines: string[] = [GENERATED_HEADER('sentinel/schemas/models/*.json'), 'import Foundation', ''];

  for (const { content: s } of models.filter((m) => m.content['isEnum'])) {
    const schema = s as Record<string, unknown>;
    lines.push(`// MARK: - ${schema['name']}`);
    lines.push(`enum ${schema['name']}: String, Codable, CaseIterable {`);
    for (const v of schema['enumValues'] as Array<{ name: string; rawValue: string }>) {
      lines.push(`    case ${v.name} = "${v.rawValue}"`);
    }
    lines.push('}', '');
  }

  for (const { content: s } of models.filter((m) => !m.content['isEnum'] && Array.isArray(m.content['fields']))) {
    const schema = s as Record<string, unknown>;
    const fields = schema['fields'] as Array<{ name: string; type: string; optional: boolean; isArray?: boolean }>;
    lines.push(`// MARK: - ${schema['name']}`);
    lines.push(`struct ${schema['name']}: Codable, Identifiable {`);
    for (const f of fields) {
      const t = swiftFieldType(f.type, f.isArray ?? false, f.optional);
      lines.push(`    ${f.optional ? 'var' : 'let'} ${f.name}: ${t}`);
    }
    lines.push('}', '');
  }

  return lines.join('\n');
}

/** Generate Swift APIClient protocol from endpoint schemas. */
function genSwiftEndpoints(endpointSchemas: SchemaFile[]): string {
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/features/*-endpoints.json'),
    'import Foundation',
    '',
    '// MARK: - APIClient Protocol',
    '//',
    '// Implement RealAPIClient (URLSession) and MockAPIClient (fixtures) conforming to this.',
    '// Inject via @Environment(\\.apiClient) — UI never knows which implementation it holds.',
    '',
    'protocol APIClient {',
  ];

  for (const { content: schema } of endpointSchemas) {
    const eps = schema['endpoints'] as Array<Record<string, unknown>>;
    lines.push(`    // ${schema['description'] ?? schema['id']}`);
    for (const ep of eps) {
      lines.push(`    func ${ep['id']}(${swiftParamList(ep)}) async throws -> ${swiftReturnType(ep)}`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function swiftParamList(ep: Record<string, unknown>): string {
  const params: string[] = [];
  const query = ep['query'] as Array<{ name: string; type: string; optional: boolean }> | undefined;
  if (query) {
    for (const q of query) {
      params.push(`${q.name}: ${swiftFieldType(q.type, false, q.optional)}`);
    }
  }
  const body = ep['body'] as { type: string } | undefined;
  if (body) params.push(`_ body: ${body.type}`);
  const pathParams = (ep['path'] as string).match(/\{(\w+)\}/g);
  if (pathParams) {
    for (const p of pathParams) {
      const name = p.slice(1, -1);
      params.unshift(`${name}: String`);
    }
  }
  return params.join(', ');
}

function swiftReturnType(ep: Record<string, unknown>): string {
  const resp = ep['response'] as { type: string; array?: boolean } | undefined;
  if (!resp || resp.type === 'Void') return 'Void';
  const base = isPrimitiveType(resp.type) ? swiftFieldType(resp.type, false, false) : resp.type;
  return resp.array ? `[${base}]` : base;
}

// ---------------------------------------------------------------------------
// Kotlin generators
// ---------------------------------------------------------------------------

function genKotlinTokens(tokens: Record<string, unknown>): string {
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/design/tokens.json'),
    '@file:Suppress("MagicNumber")',
    '',
    'package com.fitkind.design',
    '',
    'import androidx.compose.ui.graphics.Color',
    'import androidx.compose.ui.unit.dp',
    '',
  ];

  const colors = tokens['colors'] as Record<string, Record<string, { value: string; description?: string }>>;
  for (const [group, entries] of Object.entries(colors)) {
    lines.push(`object FKColor${toPascalCase(group)} {`);
    for (const [name, def] of Object.entries(entries)) {
      const { r, g, b } = hexToRgbFloat(def.value);
      const comment = def.description ? '  // ' + def.description : '';
      lines.push(`    val ${toPascalCase(name)} = Color(red = ${r}, green = ${g}, blue = ${b})${comment}`);
    }
    lines.push('}', '');
  }

  lines.push('object FKSpacing {');
  const spacing = tokens['spacing'] as Record<string, { value: string }>;
  for (const [k, v] of Object.entries(spacing)) {
    lines.push(`    val ${k === '0' ? 's0' : `s${k}`} = ${parseValue(v.value)}.dp`);
  }
  lines.push('}', '');

  lines.push('object FKRadius {');
  const radii = tokens['borderRadius'] as Record<string, { value: string; description?: string }>;
  for (const [k, v] of Object.entries(radii)) {
    const comment = v.description ? '  // ' + v.description : '';
    lines.push(`    val ${k} = ${parseValue(v.value)}.dp${comment}`);
  }
  lines.push('}', '');

  lines.push('object FKAnimation {');
  const anim = ((tokens['animation'] as { duration: Record<string, { value: string; description?: string }> } | undefined)?.duration ?? {});
  for (const [k, v] of Object.entries(anim)) {
    const comment = v.description ? '  // ' + v.description : '';
    lines.push(`    const val ${k}Ms = ${Math.round(parseValue(v.value))}${comment}`);
  }
  lines.push('}', '');

  lines.push('object FKIconSize {');
  const icons = (tokens['iconSizes'] ?? {}) as Record<string, { value: string }>;
  for (const [k, v] of Object.entries(icons)) {
    lines.push(`    val ${k} = ${parseValue(v.value)}.dp`);
  }
  lines.push('}', '');

  return lines.join('\n');
}

function genKotlinStrings(stringsSchema: Record<string, unknown>): string {
  const strings = stringsSchema['strings'] as Record<string, string>;
  const lines: string[] = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<!-- GENERATED FILE — DO NOT EDIT -->',
    '<!-- Run `npm run schema:generate` from the repo root to regenerate. -->',
    '<!-- Source: sentinel/schemas/design/strings.json -->',
    '<resources>',
  ];
  for (const [key, value] of Object.entries(strings)) {
    const resName = key.replace(/\./g, '_');
    const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '\\"');
    lines.push(`    <string name="${resName}">${escaped}</string>`);
  }
  lines.push('</resources>');
  return lines.join('\n');
}

function genKotlinFlags(flagsSchema: Record<string, unknown>): string {
  const flags = flagsSchema['flags'] as Array<{ key: string; description: string; defaultEnabled: boolean }>;
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/platform/feature-flags.json'),
    'package com.fitkind.core',
    '',
    '// Off = feature is completely hidden — no UI, no API calls.',
    'enum class FeatureFlag(val key: String, val isEnabled: Boolean) {',
  ];

  const last = flags.length - 1;
  flags.forEach((f, i) => {
    lines.push(`    ${f.key}("${f.key}", ${f.defaultEnabled})${i < last ? ',' : ';'}  // ${f.description}`);
  });

  lines.push('}');
  return lines.join('\n');
}

function kotlinFieldType(type: string, isArray: boolean, optional: boolean): string {
  const map: Record<string, string> = { UUID: 'String', String: 'String', Int: 'Int', Double: 'Double', Bool: 'Boolean', Date: 'Long', Float: 'Float' };
  let t = map[type] ?? type;
  if (isArray) t = `List<${t}>`;
  if (optional) t = `${t}?`;
  return t;
}

function genKotlinModels(models: SchemaFile[]): string {
  const lines: string[] = [GENERATED_HEADER('sentinel/schemas/models/*.json'), 'package com.fitkind.models', ''];

  for (const { content: s } of models.filter((m) => m.content['isEnum'])) {
    const schema = s as Record<string, unknown>;
    lines.push(`// ${schema['description'] ?? schema['name']}`);
    lines.push(`enum class ${schema['name']}(val rawValue: String) {`);
    const vals = schema['enumValues'] as Array<{ name: string; rawValue: string }>;
    vals.forEach((v, i) => { lines.push(`    ${v.name.toUpperCase()}("${v.rawValue}")${i < vals.length - 1 ? ',' : ';'}`); });
    lines.push('}', '');
  }

  for (const { content: s } of models.filter((m) => !m.content['isEnum'] && Array.isArray(m.content['fields']))) {
    const schema = s as Record<string, unknown>;
    const fields = schema['fields'] as Array<{ name: string; type: string; optional: boolean; isArray?: boolean }>;
    lines.push(`// ${schema['description'] ?? schema['name']}`);
    lines.push(`data class ${schema['name']}(`);
    fields.forEach((f, i) => {
      const t = kotlinFieldType(f.type, f.isArray ?? false, f.optional);
      lines.push(`    val ${f.name}: ${t}${f.optional ? ' = null' : ''}${i < fields.length - 1 ? ',' : ''}`);
    });
    lines.push(')', '');
  }

  return lines.join('\n');
}

/** Generate Kotlin APIClient interface from endpoint schemas. */
function genKotlinEndpoints(endpointSchemas: SchemaFile[]): string {
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/features/*-endpoints.json'),
    'package com.fitkind.core',
    '',
    '// APIClient interface — implement RealAPIClient (Retrofit) and MockAPIClient (fixtures).',
    '// Inject via Hilt: @Inject constructor(val apiClient: APIClient)',
    '',
    'interface APIClient {',
  ];

  for (const { content: schema } of endpointSchemas) {
    const eps = schema['endpoints'] as Array<Record<string, unknown>>;
    lines.push(`    // ${schema['description'] ?? schema['id']}`);
    for (const ep of eps) {
      lines.push(`    suspend fun ${ep['id']}(${kotlinParamList(ep)}): ${kotlinReturnType(ep)}`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function kotlinParamList(ep: Record<string, unknown>): string {
  const params: string[] = [];
  const pathParams = (ep['path'] as string).match(/\{(\w+)\}/g);
  if (pathParams) {
    for (const p of pathParams) params.push(`${p.slice(1, -1)}: String`);
  }
  const query = ep['query'] as Array<{ name: string; type: string; optional: boolean }> | undefined;
  if (query) {
    for (const q of query) {
      const t = kotlinFieldType(q.type, false, q.optional);
      params.push(`${q.name}: ${t}${q.optional ? ' = null' : ''}`);
    }
  }
  const body = ep['body'] as { type: string } | undefined;
  if (body) params.push(`body: ${body.type}`);
  return params.join(', ');
}

function kotlinReturnType(ep: Record<string, unknown>): string {
  const resp = ep['response'] as { type: string; array?: boolean } | undefined;
  if (!resp || resp.type === 'Void') return 'Unit';
  const base = isPrimitiveType(resp.type) ? kotlinFieldType(resp.type, false, false) : resp.type;
  return resp.array ? `List<${base}>` : base;
}

// ---------------------------------------------------------------------------
// Web generators (CSS + TypeScript)
// ---------------------------------------------------------------------------

function genCssTokens(tokens: Record<string, unknown>): string {
  const lines: string[] = [GENERATED_HEADER('sentinel/schemas/design/tokens.json'), ':root {'];

  const colors = tokens['colors'] as Record<string, Record<string, { value: string }>>;
  for (const [group, entries] of Object.entries(colors)) {
    lines.push(`  /* ${group} */`);
    for (const [name, def] of Object.entries(entries)) {
      const varName = `--color-${group}-${name}`.replace(/([A-Z])/g, '-$1').toLowerCase();
      lines.push(`  ${varName}: ${def.value};`);
    }
  }
  lines.push('');

  const spacing = tokens['spacing'] as Record<string, { value: string }>;
  lines.push('  /* spacing */');
  for (const [k, v] of Object.entries(spacing)) lines.push(`  --spacing-${k}: ${v.value};`);
  lines.push('');

  const radii = tokens['borderRadius'] as Record<string, { value: string }>;
  lines.push('  /* border-radius */');
  for (const [k, v] of Object.entries(radii)) lines.push(`  --radius-${k}: ${v.value};`);
  lines.push('');

  const shadows = (tokens['shadows'] ?? {}) as Record<string, { value: string }>;
  lines.push('  /* shadows */');
  for (const [k, v] of Object.entries(shadows)) lines.push(`  --shadow-${k}: ${v.value};`);
  lines.push('');

  const anim = ((tokens['animation'] as { duration: Record<string, { value: string }> } | undefined)?.duration ?? {});
  lines.push('  /* animation duration */');
  for (const [k, v] of Object.entries(anim)) lines.push(`  --duration-${k}: ${v.value};`);
  lines.push('');

  const type = (tokens['typography'] ?? {}) as { fontSizes?: Record<string, { value: string }>; fontWeights?: Record<string, { value: string }> };
  lines.push('  /* font sizes */');
  for (const [k, v] of Object.entries(type.fontSizes ?? {})) lines.push(`  --font-size-${k}: ${v.value};`);
  lines.push('  /* font weights */');
  for (const [k, v] of Object.entries(type.fontWeights ?? {})) lines.push(`  --font-weight-${k}: ${v.value};`);

  lines.push('}');
  return lines.join('\n');
}

function genTsStrings(stringsSchema: Record<string, unknown>): string {
  const strings = stringsSchema['strings'] as Record<string, string>;
  const lines: string[] = [GENERATED_HEADER('sentinel/schemas/design/strings.json'), 'export const strings = {'];
  const entries = Object.entries(strings);
  entries.forEach(([key, value], i) => {
    const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    lines.push(`  '${key}': '${escaped}'${i < entries.length - 1 ? ',' : ''}`);
  });
  lines.push('} as const;', '', 'export type StringKey = keyof typeof strings;');
  return lines.join('\n');
}

function genTsFlags(flagsSchema: Record<string, unknown>): string {
  const flags = flagsSchema['flags'] as Array<{ key: string; description: string; defaultEnabled: boolean }>;
  const lines: string[] = [GENERATED_HEADER('sentinel/schemas/platform/feature-flags.json'), '// Off = feature is completely hidden.', 'export const FeatureFlags = {'];
  flags.forEach((f, i) => {
    lines.push(`  ${f.key}: ${f.defaultEnabled}${i < flags.length - 1 ? ',' : ''}  // ${f.description}`);
  });
  lines.push('} as const;', '', 'export type FeatureFlagKey = keyof typeof FeatureFlags;');
  return lines.join('\n');
}

/** Generate TypeScript APIClient interface from endpoint schemas. */
function genTsEndpoints(endpointSchemas: SchemaFile[]): string {
  const lines: string[] = [
    GENERATED_HEADER('sentinel/schemas/features/*-endpoints.json'),
    '// Implement RealAPIClient (fetch/axios) and MockAPIClient (fixtures) with this shape.',
    '',
    'export interface APIClient {',
  ];

  for (const { content: schema } of endpointSchemas) {
    const eps = schema['endpoints'] as Array<Record<string, unknown>>;
    lines.push(`  // ${schema['description'] ?? schema['id']}`);
    for (const ep of eps) {
      lines.push(`  ${ep['id']}(${tsParamList(ep)}): Promise<${tsReturnType(ep)}>;`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

function tsParamList(ep: Record<string, unknown>): string {
  const params: string[] = [];
  const pathParams = (ep['path'] as string).match(/\{(\w+)\}/g);
  if (pathParams) {
    for (const p of pathParams) params.push(`${p.slice(1, -1)}: string`);
  }
  const query = ep['query'] as Array<{ name: string; type: string; optional: boolean }> | undefined;
  if (query && query.length > 0) {
    const fields = query.map((q) => `${q.name}${q.optional ? '?' : ''}: ${tsTsType(q.type)}`).join('; ');
    params.push(`params: { ${fields} }`);
  }
  const body = ep['body'] as { type: string } | undefined;
  if (body) params.push(`body: ${body.type}`);
  return params.join(', ');
}

function tsTsType(t: string): string {
  const map: Record<string, string> = { String: 'string', Int: 'number', Double: 'number', Float: 'number', Bool: 'boolean', UUID: 'string', Date: 'string' };
  return map[t] ?? t;
}

function tsReturnType(ep: Record<string, unknown>): string {
  const resp = ep['response'] as { type: string; array?: boolean } | undefined;
  if (!resp || resp.type === 'Void') return 'void';
  const base = tsTsType(resp.type);
  return resp.array ? `${base}[]` : base;
}

// ---------------------------------------------------------------------------
// Mock fixture validation
// ---------------------------------------------------------------------------

interface FixtureDirConfig { platform: string; path: string; }

function walkJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) results.push(full);
  }
  return results;
}

function findFixturesForModel(fixturesDir: string, modelId: string): string[] {
  return walkJsonFiles(fixturesDir).filter((f) => {
    const base = basename(f, '.json');
    return base === modelId || base === `${modelId}s` ||
      base.startsWith(`${modelId}-`) || base.startsWith(`${modelId}_`) ||
      f.includes(`/${modelId}/`) || f.includes(`/${modelId}s/`);
  });
}

function pluralise(id: string): string {
  if (id.endsWith('y') && !['ay', 'ey', 'oy', 'uy'].some((s) => id.endsWith(s))) return id.slice(0, -1) + 'ies';
  return id + 's';
}

function validateMocks(all: ReturnType<typeof loadAll>, warnings: string[]): void {
  const mockConfig = all.platform.find((s) => s.content['type'] === 'mock-config')?.content;
  if (!mockConfig) return;

  const fixtureDirs = (mockConfig['fixtures'] as FixtureDirConfig[]) ?? [];
  const modelSchemas = all.models.filter((m) => !m.content['isEnum'] && Array.isArray(m.content['fields']));

  for (const { content: model } of modelSchemas) {
    const modelId = model['id'] as string;
    const modelName = model['name'] as string;
    const fields = model['fields'] as Array<{ name: string; optional: boolean }>;
    const requiredFields = fields.filter((f) => !f.optional).map((f) => f.name);
    const allFieldNames = new Set(fields.map((f) => f.name));

    for (const { platform, path: relPath } of fixtureDirs) {
      const fixturesDir = join(ROOT, relPath);
      const matches = findFixturesForModel(fixturesDir, modelId);

      if (matches.length === 0) {
        warnings.push(`[mock:${platform}] no fixture found for model ${modelName} — run schema:generate to create stub`);
        continue;
      }

      for (const fixtureFile of matches) {
        let data: unknown;
        try { data = JSON.parse(readFileSync(fixtureFile, 'utf8')); }
        catch { warnings.push(`[mock] ${fixtureFile.replace(ROOT + '/', '')}: invalid JSON`); continue; }

        const items = Array.isArray(data) ? data : [data];
        const first = items[0] as Record<string, unknown>;
        if (!first || typeof first !== 'object') continue;

        for (const field of requiredFields) {
          if (!(field in first))
            warnings.push(`[mock] ${fixtureFile.replace(ROOT + '/', '')}: missing required field '${field}' (${modelName})`);
        }
        for (const key of Object.keys(first)) {
          if (!allFieldNames.has(key))
            warnings.push(`[mock] ${fixtureFile.replace(ROOT + '/', '')}: field '${key}' not in ${modelName} schema — drift?`);
        }
      }
    }
  }
}

function fixtureZeroValue(type: string, optional: boolean): unknown {
  if (optional) return null;
  const map: Record<string, unknown> = { UUID: '00000000-0000-0000-0000-000000000001', String: 'Example', Int: 0, Double: 0.0, Float: 0.0, Bool: false, Date: new Date().toISOString() };
  return map[type] ?? null;
}

function genFixtureStubs(all: ReturnType<typeof loadAll>): void {
  const mockConfig = all.platform.find((s) => s.content['type'] === 'mock-config')?.content;
  if (!mockConfig) return;

  const fixtureDirs = (mockConfig['fixtures'] as FixtureDirConfig[]) ?? [];
  const modelSchemas = all.models.filter((m) => !m.content['isEnum'] && Array.isArray(m.content['fields']));

  for (const { content: model } of modelSchemas) {
    const modelId = model['id'] as string;
    const fields = model['fields'] as Array<{ name: string; type: string; optional: boolean; isArray?: boolean }>;

    for (const { path: relPath } of fixtureDirs) {
      const fixturesDir = join(ROOT, relPath);
      if (findFixturesForModel(fixturesDir, modelId).length > 0) continue;

      const stub: Record<string, unknown> = {};
      for (const f of fields) {
        const val = fixtureZeroValue(f.type, f.optional);
        stub[f.name] = f.isArray ? (val === null ? [] : [val]) : val;
      }

      const stubDir = join(fixturesDir, pluralise(modelId));
      const stubFile = join(stubDir, `${modelId}.json`);
      mkdirSync(stubDir, { recursive: true });
      writeFileSync(stubFile, JSON.stringify([stub], null, 2) + '\n', 'utf8');
      console.log(`  stub  ${stubFile.replace(ROOT + '/', '')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// schema:generate  (reads sentinel.yaml for output paths)
// ---------------------------------------------------------------------------

function cmdGenerate(): void {
  console.log('Generating platform files...\n');

  const all = loadAll();
  const config = loadSentinelConfig();

  const tokensSchema = all.design.find((s) => s.content['type'] === 'tokens')?.content;
  const stringsSchema = all.design.find((s) => s.content['type'] === 'strings')?.content;
  const flagsSchema = all.platform.find((s) => s.content['type'] === 'feature-flags')?.content;
  const endpointSchemas = all.features.filter((s) => s.content['type'] === 'endpoints');

  if (!tokensSchema) throw new Error('tokens.json not found in sentinel/schemas/design/');
  if (!stringsSchema) throw new Error('strings.json not found in sentinel/schemas/design/');
  if (!flagsSchema) throw new Error('feature-flags.json not found in sentinel/schemas/platform/');

  for (const [, cfg] of Object.entries(config.platforms)) {
    const out = cfg.output ?? {};
    const lang = cfg.language ?? '';

    if (lang === 'swift') {
      if (out.tokens) writeFile(join(ROOT, out.tokens), genSwiftTokens(tokensSchema));
      if (out.strings) writeFile(join(ROOT, out.strings), genSwiftStrings(stringsSchema));
      if (out.flags) writeFile(join(ROOT, out.flags), genSwiftFlags(flagsSchema));
      if (out.models) writeFile(join(ROOT, out.models), genSwiftModels(all.models));
      if (out.endpoints && endpointSchemas.length > 0)
        writeFile(join(ROOT, out.endpoints), genSwiftEndpoints(endpointSchemas));
    } else if (lang === 'kotlin') {
      if (out.tokens) writeFile(join(ROOT, out.tokens), genKotlinTokens(tokensSchema));
      if (out.strings) writeFile(join(ROOT, out.strings), genKotlinStrings(stringsSchema));
      if (out.flags) writeFile(join(ROOT, out.flags), genKotlinFlags(flagsSchema));
      if (out.models) writeFile(join(ROOT, out.models), genKotlinModels(all.models));
      if (out.endpoints && endpointSchemas.length > 0)
        writeFile(join(ROOT, out.endpoints), genKotlinEndpoints(endpointSchemas));
    } else if (lang === 'typescript') {
      if (out.tokens) writeFile(join(ROOT, out.tokens), genCssTokens(tokensSchema));
      if (out.strings) writeFile(join(ROOT, out.strings), genTsStrings(stringsSchema));
      if (out.flags) writeFile(join(ROOT, out.flags), genTsFlags(flagsSchema));
      if (out.endpoints && endpointSchemas.length > 0)
        writeFile(join(ROOT, out.endpoints), genTsEndpoints(endpointSchemas));
    }
  }

  genFixtureStubs(all);

  console.log('\n✓ Generation complete.');
}

// ---------------------------------------------------------------------------
// mock:generate — generate transport-layer interception glue for iOS + Android
// ---------------------------------------------------------------------------
//
// Reads sentinel/schemas/platform/mock-config.json for endpoint→fixture mappings.
// Generates:
//   iOS:     MockURLProtocol.swift  — URLProtocol subclass, intercepts URLSession at transport level
//   Android: MockDispatcher.kt      — WireMock RequestDispatcher, maps paths → fixture assets
//
// Both files are written to the paths declared in sentinel.yaml under each platform's
// output.mock field. Register in DEBUG builds only — app code is completely unaware.
//
// Usage:
//   sentinel mock:generate   — write glue code
//   sentinel mock:validate   — validate all fixtures against endpoint response schemas

interface EndpointFixtureMapping {
  method: string;          // GET, POST, PATCH, DELETE
  path: string;            // e.g. /api/v1/radar/nearby
  fixture: string;         // relative path under sentinel/fixtures/
  statusCode?: number;     // default 200
}

interface MockConfig {
  fixtures: Array<{ platform: string; path: string }>;
  endpoints: EndpointFixtureMapping[];
}

function loadMockConfig(): MockConfig | null {
  const all = loadAll();
  const raw = all.platform.find((s) => s.content['type'] === 'mock-config')?.content;
  if (!raw) return null;
  return raw as unknown as MockConfig;
}

// Normalise path pattern → regex that also matches with query strings
// e.g. /api/v1/radar/nearby → ^/api/v1/radar/nearby(\?.*)?$
// e.g. /api/v1/chat/:matchId/messages → ^/api/v1/chat/[^/]+/messages(\?.*)?$
function pathToPattern(p: string): string {
  return '^' + p.replace(/:[^/]+/g, '[^/]+') + '(\\?.*)?$';
}

function genSwiftMockURLProtocol(mappings: EndpointFixtureMapping[]): string {
  const cases = mappings
    .map((m) => {
      const pattern = pathToPattern(m.path);
      const method = m.method.toUpperCase();
      const fixture = m.fixture;
      const status = m.statusCode ?? 200;
      return `        // ${method} ${m.path}\n        Route(method: "${method}", pattern: #"${pattern}"#, fixture: "${fixture}", status: ${status}),`;
    })
    .join('\n');

  return `// GENERATED FILE — DO NOT EDIT
// Run \`sentinel mock:generate\` to regenerate from sentinel/schemas/platform/mock-config.json
//
// Intercepts all URLSession requests at transport level in DEBUG builds.
// Register once in your App entry point:
//
//   #if DEBUG
//   URLProtocol.registerClass(MockURLProtocol.self)
//   #endif
//
// Fixture JSON files are read from the app bundle (add sentinel/fixtures/ as a folder
// reference in Xcode — do NOT add to Release target).

#if DEBUG
import Foundation

final class MockURLProtocol: URLProtocol {

    private struct Route {
        let method: String
        let pattern: String
        let fixture: String
        let status: Int
    }

    // ---------------------------------------------------------------------------
    // Route table — generated from sentinel/schemas/platform/mock-config.json
    // ---------------------------------------------------------------------------
    private static let routes: [Route] = [
${cases}
    ]

    // ---------------------------------------------------------------------------
    // URLProtocol overrides
    // ---------------------------------------------------------------------------

    override class func canInit(with request: URLRequest) -> Bool {
        guard let url = request.url, let method = request.httpMethod else { return false }
        let path = url.path + (url.query.map { "?\\($0)" } ?? "")
        return routes.contains { r in
            r.method == method.uppercased() &&
            (try? NSRegularExpression(pattern: r.pattern))
                .map { $0.firstMatch(in: path, range: NSRange(path.startIndex..., in: path)) != nil } ?? false
        }
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url, let method = request.httpMethod else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL)); return
        }
        let path = url.path + (url.query.map { "?\\($0)" } ?? "")
        guard let route = Self.routes.first(where: { r in
            r.method == method.uppercased() &&
            (try? NSRegularExpression(pattern: r.pattern))
                .map { $0.firstMatch(in: path, range: NSRange(path.startIndex..., in: path)) != nil } ?? false
        }) else {
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist)); return
        }

        // Load fixture from bundle — sentinel/fixtures/ added as folder reference
        let parts = route.fixture.split(separator: "/")
        let name = parts.last.map(String.init)?.replacingOccurrences(of: ".json", with: "") ?? ""
        let subdir = parts.dropLast().joined(separator: "/")
        guard
            let bundleURL = Bundle.main.url(forResource: name, withExtension: "json", subdirectory: subdir),
            let data = try? Data(contentsOf: bundleURL)
        else {
            print("[MockURLProtocol] fixture not found: \\(route.fixture)")
            client?.urlProtocol(self, didFailWithError: URLError(.fileDoesNotExist))
            return
        }

        let response = HTTPURLResponse(
            url: url,
            statusCode: route.status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!

        // Simulate a small network delay so loading states are visible
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) {
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
#endif
`;
}

function genKotlinMockDispatcher(mappings: EndpointFixtureMapping[]): string {
  const cases = mappings
    .map((m) => {
      const pattern = pathToPattern(m.path);
      const method = m.method.toUpperCase();
      const fixture = m.fixture;
      const status = m.statusCode ?? 200;
      return `        // ${method} ${m.path}\n        Route("${method}", Regex("${pattern}"), "${fixture}", ${status}),`;
    })
    .join('\n');

  return `// GENERATED FILE — DO NOT EDIT
// Run \`sentinel mock:generate\` to regenerate from sentinel/schemas/platform/mock-config.json
//
// WireMock dispatcher for Android debug builds.
// Wire up in your debug Hilt module:
//
//   @Module @InstallIn(SingletonComponent::class)
//   object DebugNetworkModule {
//       @Provides @Singleton
//       fun provideOkHttpClient(): OkHttpClient {
//           val server = MockWebServer().apply {
//               dispatcher = MockDispatcher(context.assets)
//               start(8080)
//           }
//           return OkHttpClient.Builder().build()
//       }
//   }
//
// Fixture JSON files live in sentinel/fixtures/ — symlink or copy to
// android/app/src/debug/assets/fixtures/ (excluded from release builds).

package app.sentinel.mock

import com.squareup.okhttp.mockwebserver.Dispatcher
import com.squareup.okhttp.mockwebserver.MockResponse
import com.squareup.okhttp.mockwebserver.RecordedRequest
import android.content.res.AssetManager

class MockDispatcher(private val assets: AssetManager) : Dispatcher() {

    private data class Route(
        val method: String,
        val pattern: Regex,
        val fixture: String,
        val status: Int,
    )

    // ---------------------------------------------------------------------------
    // Route table — generated from sentinel/schemas/platform/mock-config.json
    // ---------------------------------------------------------------------------
    private val routes = listOf(
${cases}
    )

    override fun dispatch(request: RecordedRequest): MockResponse {
        val method = request.method?.uppercase() ?: "GET"
        val path = request.path ?: "/"

        val route = routes.firstOrNull { r ->
            r.method == method && r.pattern.containsMatchIn(path)
        }

        if (route == null) {
            return MockResponse().setResponseCode(404).setBody("""{"error":"No mock for $method $path"}""")
        }

        return try {
            val json = assets.open("fixtures/\${route.fixture}").bufferedReader().readText()
            MockResponse()
                .setResponseCode(route.status)
                .setHeader("Content-Type", "application/json")
                .setBody(json)
                .setBodyDelay(300, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (e: Exception) {
            MockResponse().setResponseCode(500).setBody("""{"error":"Fixture not found: \${route.fixture}"}""")
        }
    }
}
`;
}

function cmdMockGenerate(): void {
  console.log('Generating mock transport glue...\n');

  const mockConfig = loadMockConfig();
  if (!mockConfig) {
    console.error('  ✗ No mock-config schema found. Add sentinel/schemas/platform/mock-config.json');
    process.exit(1);
  }

  const mappings: EndpointFixtureMapping[] = mockConfig.endpoints ?? [];
  if (mappings.length === 0) {
    console.warn('  ⚠ No endpoint→fixture mappings in mock-config.json — add an "endpoints" array.');
    return;
  }

  const config = loadSentinelConfig();
  let generated = 0;

  for (const [, cfg] of Object.entries(config.platforms)) {
    const mockOut = (cfg.output as Record<string, string> | undefined)?.mock;
    if (!mockOut) continue;

    if (cfg.language === 'swift') {
      writeFile(join(ROOT, mockOut), genSwiftMockURLProtocol(mappings));
      console.log(`  swift  ${mockOut}`);
      generated++;
    } else if (cfg.language === 'kotlin') {
      writeFile(join(ROOT, mockOut), genKotlinMockDispatcher(mappings));
      console.log(`  kotlin ${mockOut}`);
      generated++;
    }
  }

  if (generated === 0) {
    console.warn('  ⚠ No platforms with output.mock defined in sentinel.yaml — nothing generated.');
    console.warn('  Add output.mock: path/to/MockURLProtocol.swift under the ios platform.');
  } else {
    console.log(`\n✓ Generated ${generated} mock transport file(s).`);
    console.log('  Register in your DEBUG entry point — see file header comments for instructions.');
  }
}

function cmdMockValidate(): void {
  console.log('Validating fixtures against endpoint response schemas...\n');

  const mockConfig = loadMockConfig();
  if (!mockConfig) {
    console.error('  ✗ No mock-config schema found.');
    process.exit(1);
  }

  const all = loadAll();
  const errors: string[] = [];
  const warnings: string[] = [];
  const mappings: EndpointFixtureMapping[] = mockConfig.endpoints ?? [];

  for (const mapping of mappings) {
    const fixturePath = join(ROOT, 'sentinel', 'fixtures', mapping.fixture);
    if (!existsSync(fixturePath)) {
      errors.push(`  ✗ Fixture not found: sentinel/fixtures/${mapping.fixture}`);
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(readFileSync(fixturePath, 'utf8'));
    } catch {
      errors.push(`  ✗ Invalid JSON: sentinel/fixtures/${mapping.fixture}`);
      continue;
    }

    // Find the endpoint schema for this path
    const endpointSchemas = all.features.filter((s) => s.content['type'] === 'endpoints');
    let matchedEndpoint: Record<string, unknown> | null = null;

    for (const { content } of endpointSchemas) {
      const eps = (content['endpoints'] as Array<Record<string, unknown>>) ?? [];
      const ep = eps.find((e) => {
        const epPath = `${content['base'] ?? '/api/v1'}${e['path']}`;
        return e['method'] === mapping.method && epPath === mapping.path;
      });
      if (ep) { matchedEndpoint = ep; break; }
    }

    if (!matchedEndpoint) {
      warnings.push(`  ⚠ No endpoint schema for ${mapping.method} ${mapping.path} — add to features/*.json`);
      continue;
    }

    // Validate top-level response fields if declared inline
    const response = matchedEndpoint['response'] as Record<string, unknown> | undefined;
    if (response?.fields) {
      const fields = response.fields as Array<{ name: string; optional: boolean }>;
      const required = fields.filter((f) => !f.optional).map((f) => f.name);
      const root = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {};
      for (const field of required) {
        if (!(field in root)) {
          errors.push(`  ✗ sentinel/fixtures/${mapping.fixture}: missing required field '${field}' (${mapping.method} ${mapping.path})`);
        }
      }
    }

    console.log(`  ✓ ${mapping.method} ${mapping.path} → ${mapping.fixture}`);
  }

  if (warnings.length) { console.log(''); warnings.forEach((w) => console.log(w)); }
  if (errors.length) {
    console.log('');
    errors.forEach((e) => console.error(e));
    console.log(`\n✗ ${errors.length} fixture validation error(s).`);
    process.exit(1);
  } else {
    console.log(`\n✓ All ${mappings.length} fixture(s) valid.`);
  }
}

// ---------------------------------------------------------------------------
// contracts
// ---------------------------------------------------------------------------

function cmdContracts(): void {
  console.log('Validating API contracts...');
  cmdValidate();

  const all = loadAll();
  const endpointSchemas = all.features.filter((s) => s.content['type'] === 'endpoints');
  if (endpointSchemas.length === 0) {
    console.log('  No endpoint schemas found. Add type:"endpoints" schemas to sentinel/schemas/features/ to get contract validation.');
  } else {
    console.log(`  Found ${endpointSchemas.length} endpoint schema(s):`);
    for (const { content } of endpointSchemas) {
      const eps = content['endpoints'] as Array<Record<string, unknown>>;
      console.log(`    ${content['id']} — ${eps.length} endpoint(s)`);
    }
    console.log('  ✓ All endpoint model references valid.');
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const cmd = process.argv[2];

switch (cmd) {
  case 'schema:validate': cmdValidate(); break;
  case 'schema:generate': cmdGenerate(); break;
  case 'contracts': cmdContracts(); break;
  case 'contracts:matrix': cmdContracts(); break;
  case 'mock:generate': cmdMockGenerate(); break;
  case 'mock:validate': cmdMockValidate(); break;
  case 'all': cmdValidate(); cmdGenerate(); cmdMockGenerate(); break;
  default:
    console.error(`Unknown command: ${cmd ?? '(none)'}`);
    console.error('Usage: sentinel schema:validate | schema:generate | contracts | mock:generate | mock:validate | all');
    process.exit(1);
}
