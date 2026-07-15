/**
 * Sentinel CLI — Cross-platform schema validation and code generation.
 *
 * Enforces sync between iOS (Swift), Android (Kotlin), Backend (TypeScript/NestJS),
 * and Web frontends. Reads all output paths from sentinel.yaml — works for any project.
 *
 * Commands:
 *   schema:validate  — Validate schemas, check stale generated files, warn on unused keys.
 *   schema:generate  — Generate all platform files from schemas.
 *   contracts        — Validate API endpoint contracts.
 *   contracts:matrix — Show feature completeness and cross-platform coverage.
 *   mock:generate    — Generate MockURLProtocol.swift + MockDispatcher.kt.
 *   mock:validate    — Validate fixture JSON against endpoint schemas.
 *   registry:scan    — Find screen files not registered in sentinel.yaml screens:.
 *   all              — validate → generate → mock:generate.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs'
import { join, dirname, basename, relative, resolve, sep } from 'path'
import chalk from 'chalk'
import { findConfigFile, loadConfig } from '../config/loader.js'
import { generateAll } from '../schema/index.js'
import { checkInvariants } from '../schema/validators/invariants.js'
import { checkStaleness } from '../schema/validators/staleness.js'
import { lintHardcodedTokens } from '../schema/linters/hardcoded-tokens.js'
import { checkQuality } from '../schema/validators/quality.js'
import { scanRegistry } from '../catalog/registry.js'
import { checkMockIntegration, findFixturePathCandidates, pluraliseFixtureDirectory } from '../mock/integration.js'
import { runDoctorCheck } from '../doctor/check.js'
import { buildFeatureMatrix, printMatrix } from '../contracts/feature-matrix.js'
import { formatWarningSummary } from './warnings.js'
import { cmdAtlasExport, cmdAtlasImport, cmdAtlasMigrate } from './atlas.js'
import type { PlatformKey, ResolvedConfig } from '../config/types.js'
import type { AtlasManifestFixture, AtlasSessionCaptureIndex } from '../catalog/atlas-compat.js'

// ---------------------------------------------------------------------------
// Schema loading
// ---------------------------------------------------------------------------

interface SchemaFile {
  filename: string
  content: Record<string, unknown>
}

function loadDir(schemasDir: string, subdir: string): SchemaFile[] {
  const dir = join(schemasDir, subdir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({
      filename: f,
      content: JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>,
    }))
}

function loadAll(schemasDir: string) {
  return {
    design:   loadDir(schemasDir, 'design'),
    features: loadDir(schemasDir, 'features'),
    models:   loadDir(schemasDir, 'models'),
    platform: loadDir(schemasDir, 'platform'),
  }
}

// ---------------------------------------------------------------------------
// --write-status support
// ---------------------------------------------------------------------------

interface StatusReport {
  lastRun: string
  schemas: Array<{ name: string; valid: boolean; errors: string[] }>
  contracts: Array<{ name: string; passing: boolean }>
  mocks: Array<{ endpoint: string; coverage: boolean }>
}

function parseWriteStatus(): string | null {
  const idx = process.argv.indexOf('--write-status')
  if (idx === -1 || idx + 1 >= process.argv.length) return null
  return process.argv[idx + 1]
}

function writeStatusFile(path: string, report: StatusReport): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log(`  status written to ${path}`)
}

function emptyReport(): StatusReport {
  return { lastRun: new Date().toISOString(), schemas: [], contracts: [], mocks: [] }
}

function parseMaxWarnings(): number {
  const idx = process.argv.indexOf('--max-warnings')
  if (idx === -1 || idx + 1 >= process.argv.length) return 40

  const parsed = Number.parseInt(process.argv[idx + 1] ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 40
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeFile(filePath: string, content: string, projectRoot: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, content, 'utf8')
  console.log(`  wrote ${filePath.replace(projectRoot + '/', '')}`)
}

function isPrimitiveType(t: string): boolean {
  return ['String', 'Int', 'Double', 'Float', 'Bool', 'Date', 'UUID', 'Void'].includes(t)
}

function deriveKotlinPackage(outputPath: string): string {
  const match = outputPath.match(/kotlin\/(.+)\/[^/]+\.kt$/)
  if (match) return match[1].replace(/\//g, '.')
  return 'app.sentinel.mock'
}

function formatIssueMessage(message: string, file: string | undefined, projectRoot: string): string {
  if (!file) return message
  return `${message} [${relative(projectRoot, file)}]`
}

// ---------------------------------------------------------------------------
// schema:validate
// ---------------------------------------------------------------------------

function cmdValidate(): StatusReport {
  const report = emptyReport()
  const config = loadConfig()
  const all = loadAll(config.schemasDir)
  const errors: string[] = []
  const warnings: string[] = []

  // Build reference sets for cross-validation
  const stringsSchema = all.design.find((s) => s.content['type'] === 'strings')?.content
  const flagsSchema   = all.platform.find((s) => s.content['type'] === 'feature-flags')?.content
  const allStringKeys = new Set(Object.keys((stringsSchema?.['strings'] as Record<string, string>) ?? {}))
  const allFlagKeys   = new Set(((flagsSchema?.['flags'] as { key: string }[]) ?? []).map((f) => f.key))
  const allModelNames = new Set(all.models.map((s) => s.content['name'] as string).filter(Boolean))

  const referencedStringKeys = new Set<string>()
  const referencedModelNames = new Set<string>()

  const check = (filename: string, schema: Record<string, unknown>) => {
    if (!schema['$sentinel']) errors.push(`${filename}: missing '$sentinel' field`)
    if (!schema['type'])      errors.push(`${filename}: missing 'type' field`)

    switch (schema['type']) {
      case 'tokens':
        if (!schema['colors'])     errors.push(`${filename}: missing 'colors'`)
        if (!schema['typography']) errors.push(`${filename}: missing 'typography'`)
        if (!schema['spacing'])    errors.push(`${filename}: missing 'spacing'`)
        break

      case 'strings':
        if (!Array.isArray(schema['locales']) || !(schema['locales'] as unknown[]).length)
          errors.push(`${filename}: missing 'locales' array`)
        if (typeof schema['strings'] !== 'object')
          errors.push(`${filename}: missing 'strings' object`)
        break

      case 'feature-flags':
        if (!Array.isArray(schema['flags']))
          errors.push(`${filename}: missing 'flags' array`)
        break

      case 'navigation':
        if (!Array.isArray(schema['tabs']))   errors.push(`${filename}: missing 'tabs' array`)
        if (!Array.isArray(schema['routes'])) errors.push(`${filename}: missing 'routes' array`)
        break

      case 'feature':
        if (!schema['id'])        errors.push(`${filename}: missing 'id'`)
        if (!schema['name'])      errors.push(`${filename}: missing 'name'`)
        if (!schema['milestone']) errors.push(`${filename}: missing 'milestone'`)
        for (const m of (schema['models'] as string[]) ?? []) {
          if (!allModelNames.has(m)) errors.push(`${filename}: references unknown model '${m}'`)
          else referencedModelNames.add(m)
        }
        for (const f of (schema['flags'] as string[]) ?? []) {
          if (!allFlagKeys.has(f)) errors.push(`${filename}: references unknown flag '${f}'`)
        }
        for (const sk of (schema['strings'] as string[]) ?? []) {
          if (!allStringKeys.has(sk)) errors.push(`${filename}: references unknown string key '${sk}'`)
          else referencedStringKeys.add(sk)
        }
        break

      case 'model':
        if (!schema['id'])   errors.push(`${filename}: missing 'id'`)
        if (!schema['name']) errors.push(`${filename}: missing 'name'`)
        if (!schema['isEnum'] && !Array.isArray(schema['fields']))
          errors.push(`${filename}: must have 'isEnum: true' or 'fields' array`)
        if (schema['isEnum'] && !Array.isArray(schema['enumValues']))
          errors.push(`${filename}: enum model missing 'enumValues'`)
        break

      case 'endpoints': {
        if (!schema['id']) errors.push(`${filename}: missing 'id'`)
        if (!Array.isArray(schema['endpoints'])) {
          errors.push(`${filename}: missing 'endpoints' array`)
          break
        }
        const eps = schema['endpoints'] as Array<Record<string, unknown>>
        for (const ep of eps) {
          if (!ep['id'])     errors.push(`${filename}: endpoint missing 'id'`)
          if (!ep['method']) errors.push(`${filename}: endpoint '${ep['id']}' missing 'method'`)
          if (!ep['path'])   errors.push(`${filename}: endpoint '${ep['id']}' missing 'path'`)
          const resp = ep['response'] as Record<string, unknown> | undefined
          if (resp?.['type'] && typeof resp['type'] === 'string' && !isPrimitiveType(resp['type'])) {
            if (!allModelNames.has(resp['type']))
              errors.push(`${filename}: endpoint '${ep['id']}' response type '${resp['type']}' is not a known model`)
            else referencedModelNames.add(resp['type'] as string)
          }
          const body = ep['body'] as Record<string, unknown> | undefined
          if (body?.['type'] && typeof body['type'] === 'string' && !isPrimitiveType(body['type'])) {
            if (!allModelNames.has(body['type']))
              errors.push(`${filename}: endpoint '${ep['id']}' body type '${body['type']}' is not a known model`)
            else referencedModelNames.add(body['type'] as string)
          }
        }
        break
      }

      case 'mock-config':
        if (!Array.isArray(schema['fixtures']))
          errors.push(`${filename}: missing 'fixtures' array`)
        break

      default:
        break
    }
  }

  const allSchemas = [...all.design, ...all.features, ...all.models, ...all.platform]
  for (const { filename, content } of allSchemas) {
    const errorsBefore = errors.length
    check(filename, content)
    const schemaErrors = errors.slice(errorsBefore)
    report.schemas.push({ name: filename, valid: schemaErrors.length === 0, errors: schemaErrors })
  }

  // ── Unused string keys ─────────────────────────────────────────────────────
  for (const key of allStringKeys) {
    if (!referencedStringKeys.has(key))
      warnings.push(`strings.json: key '${key}' defined but not referenced by any feature schema`)
  }

  // ── Unreferenced models ───────────────────────────────────────────────────
  for (const name of allModelNames) {
    if (!referencedModelNames.has(name))
      warnings.push(`model '${name}' not referenced by any feature or endpoint schema`)
  }

  // ── Staleness detection (hash-based, CI-safe) ─────────────────────────────
  const staleness = checkStaleness(config)
  for (const issue of staleness.issues) {
    const formatted = formatIssueMessage(issue.message, issue.file, config.projectRoot)
    if (issue.severity === 'error') errors.push(formatted)
    else warnings.push(formatted)
  }

  const invariants = checkInvariants(config)
  for (const issue of invariants.issues) {
    const formatted = formatIssueMessage(issue.message, issue.file, config.projectRoot)
    if (issue.severity === 'error') errors.push(formatted)
    else warnings.push(formatted)
  }

  // ── Mock fixture warnings ─────────────────────────────────────────────────
  validateMocks(all, warnings, config.projectRoot)

  const total = all.design.length + all.features.length + all.models.length + all.platform.length

  formatWarningSummary(warnings, parseMaxWarnings()).forEach((line) => console.warn(line))

  if (errors.length > 0) {
    console.error(`\n✗ Schema validation failed:\n`)
    errors.forEach((e) => console.error(`  • ${e}`))
    console.error(`\n${errors.length} error(s) in ${total} schemas.\n`)
    // Don't exit yet — let caller write status first
  } else {
    console.log(`\n✓ All ${total} schemas valid.`)
  }

  return report
}

// ---------------------------------------------------------------------------
// Mock fixture validation
// ---------------------------------------------------------------------------

interface FixtureDirConfig { platform: string; path: string }

function walkJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  const results: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) results.push(...walkJsonFiles(full))
    else if (entry.isFile() && entry.name.endsWith('.json')) results.push(full)
  }
  return results
}

function findFixturesForModel(fixturesDir: string, modelId: string): string[] {
  return walkJsonFiles(fixturesDir).filter((f) => {
    const base = basename(f, '.json')
    const parts = relative(fixturesDir, f).split(sep)
    const directories = parts.slice(0, -1)
    return base === modelId
      || directories.includes(modelId)
      || directories.includes(`${modelId}s`)
  })
}

function validateMocks(all: ReturnType<typeof loadAll>, warnings: string[], projectRoot: string): void {
  const mockConfig = all.platform.find((s) => s.content['type'] === 'mock-config')?.content
  if (!mockConfig) return

  const fixtureDirs = (mockConfig['fixtures'] as FixtureDirConfig[]) ?? []
  const modelSchemas = all.models.filter((m) => !m.content['isEnum'] && Array.isArray(m.content['fields']))

  for (const { content: model } of modelSchemas) {
    const modelId      = model['id'] as string
    const modelName    = model['name'] as string
    const fields       = model['fields'] as Array<{ name: string; optional: boolean }>
    const requiredFields = fields.filter((f) => !f.optional).map((f) => f.name)
    const allFieldNames  = new Set(fields.map((f) => f.name))

    for (const { platform, path: relPath } of fixtureDirs) {
      const fixturesDir = join(projectRoot, relPath)
      const matches = findFixturesForModel(fixturesDir, modelId)

      if (matches.length === 0) {
        warnings.push(`[mock:${platform}] no fixture found for model ${modelName} — run schema:generate to create stub`)
        continue
      }

      for (const fixtureFile of matches) {
        let data: unknown
        try { data = JSON.parse(readFileSync(fixtureFile, 'utf8')) }
        catch { warnings.push(`[mock] ${fixtureFile.replace(projectRoot + '/', '')}: invalid JSON`); continue }

        const items = Array.isArray(data) ? data : [data]
        const first = items[0] as Record<string, unknown>
        if (!first || typeof first !== 'object') continue

        for (const field of requiredFields) {
          if (!(field in first))
            warnings.push(`[mock] ${fixtureFile.replace(projectRoot + '/', '')}: missing required field '${field}' (${modelName})`)
        }
        for (const key of Object.keys(first)) {
          if (!allFieldNames.has(key))
            warnings.push(`[mock] ${fixtureFile.replace(projectRoot + '/', '')}: field '${key}' not in ${modelName} schema — drift?`)
        }
      }
    }
  }
}

function fixtureZeroValue(type: string, optional: boolean): unknown {
  if (optional) return null
  const map: Record<string, unknown> = {
    UUID: '00000000-0000-0000-0000-000000000001',
    String: 'Example', Int: 0, Double: 0.0, Float: 0.0, Bool: false,
    Date: new Date().toISOString(),
  }
  return map[type] ?? null
}

function genFixtureStubs(all: ReturnType<typeof loadAll>, config: ResolvedConfig): void {
  const mockConfig = all.platform.find((s) => s.content['type'] === 'mock-config')?.content
  if (!mockConfig) return

  const fixtureDirs = (mockConfig['fixtures'] as FixtureDirConfig[]) ?? []
  const modelSchemas = all.models.filter((m) => !m.content['isEnum'] && Array.isArray(m.content['fields']))

  for (const { content: model } of modelSchemas) {
    const modelId = model['id'] as string
    const fields  = model['fields'] as Array<{ name: string; type: string; optional: boolean; isArray?: boolean }>

    for (const { path: relPath } of fixtureDirs) {
      const fixturesDir = join(config.projectRoot, relPath)
      if (findFixturesForModel(fixturesDir, modelId).length > 0) continue

      const stub: Record<string, unknown> = {}
      for (const f of fields) {
        const val = fixtureZeroValue(f.type, f.optional)
        stub[f.name] = f.isArray ? (val === null ? [] : [val]) : val
      }

      const stubDir  = join(fixturesDir, pluraliseFixtureDirectory(modelId))
      const stubFile = join(stubDir, `${modelId}.json`)
      mkdirSync(stubDir, { recursive: true })
      writeFileSync(stubFile, JSON.stringify([stub], null, 2) + '\n', 'utf8')
      console.log(`  stub  ${stubFile.replace(config.projectRoot + '/', '')}`)
    }
  }
}

// ---------------------------------------------------------------------------
// schema:generate
// ---------------------------------------------------------------------------

async function cmdGenerate(): Promise<void> {
  const config = loadConfig()
  await generateAll(config)
  genFixtureStubs(loadAll(config.schemasDir), config)
  console.log('\n✓ Generation complete.')
}

// ---------------------------------------------------------------------------
// mock:generate — generate transport-layer interception glue for iOS + Android
// ---------------------------------------------------------------------------
//
// Reads sentinel/schemas/platform/mock-config.json for endpoint→fixture mappings.
// Generates:
//   iOS:     MockURLProtocol.swift  — URLProtocol subclass, intercepts URLSession at transport level
//   Android: MockDispatcher.kt      — MockWebServer Dispatcher, maps paths → fixture assets
//
// Both files are written to the paths declared in sentinel.yaml under each platform's
// output.mock field. Register in DEBUG builds only — app code is completely unaware.

interface EndpointFixtureMapping {
  method: string      // GET, POST, PATCH, DELETE
  path: string        // e.g. /api/v1/users/:id
  fixture: string     // relative path under sentinel/fixtures/
  statusCode?: number // default 200
}

interface MockConfig {
  fixtures: Array<{ platform: string; path: string }>
  endpoints: EndpointFixtureMapping[]
}

const SENTINEL_PACKAGE_NAME = '@sentinel/cli'

function loadMockConfig(config: ResolvedConfig): MockConfig | null {
  const all = loadAll(config.schemasDir)
  const raw = all.platform.find((s) => s.content['type'] === 'mock-config')?.content
  if (!raw) return null
  return raw as unknown as MockConfig
}

// Normalise path pattern → regex that also matches with query strings.
// Use a character class for "?" so the generated pattern is valid in
// both Swift raw strings and Kotlin quoted strings.
// e.g. /api/v1/users/:id → ^/api/v1/users/[^/]+([?].*)?$
function pathToPattern(p: string): string {
  return '^' + p.replace(/:[^/]+/g, '[^/]+') + '([?].*)?$'
}

function genSwiftMockURLProtocol(mappings: EndpointFixtureMapping[]): string {
  const cases = mappings
    .map((m) => {
      const pattern = pathToPattern(m.path)
      const method  = m.method.toUpperCase()
      const status  = m.statusCode ?? 200
      return `        // ${method} ${m.path}\n        Route(method: "${method}", pattern: #"${pattern}"#, fixture: "${m.fixture}", status: ${status}),`
    })
    .join('\n')

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

        // Load fixture from bundle — sentinel/fixtures/ added as folder reference in Xcode.
        // The folder reference appears as "fixtures" at the bundle root, so subdirectory
        // must be prefixed with "fixtures/" (e.g. "fixtures/auth" not just "auth").
        let parts = route.fixture.split(separator: "/")
        let name  = parts.last.map(String.init)?.replacingOccurrences(of: ".json", with: "") ?? ""
        let subdir = parts.count > 1
            ? "fixtures/" + parts.dropLast().joined(separator: "/")
            : "fixtures"
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

        // Simulate a small network delay so loading states are visible in UI
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) {
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: data)
            self.client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}
#endif
`
}

function genKotlinMockDispatcher(mappings: EndpointFixtureMapping[], outputPath: string): string {
  const pkg   = deriveKotlinPackage(outputPath)
  const cases = mappings
    .map((m) => {
      const pattern = pathToPattern(m.path)
      const method  = m.method.toUpperCase()
      const status  = m.statusCode ?? 200
      return `        // ${method} ${m.path}\n        Route("${method}", Regex("${pattern}"), "${m.fixture}", ${status}),`
    })
    .join('\n')

  return `// GENERATED FILE — DO NOT EDIT
// Run \`sentinel mock:generate\` to regenerate from sentinel/schemas/platform/mock-config.json
//
// MockWebServer dispatcher for Android debug builds.
// Wire up in your debug Hilt module (src/debug/):
//
//   @Module @InstallIn(SingletonComponent::class)
//   object DebugNetworkModule {
//       @Provides @Singleton
//       fun provideMockWebServer(@ApplicationContext context: Context): MockWebServer =
//           MockWebServer().apply { dispatcher = MockDispatcher(context.assets); start() }
//       @Provides @Singleton @Named("apiBaseUrl")
//       fun provideBaseUrl(server: MockWebServer): String = server.url("/").toString()
//   }
//
// Fixture JSON files live in sentinel/fixtures/ — symlink or copy to
// app/src/debug/assets/fixtures/ (excluded from release builds by source set).

package ${pkg}

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
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
        val path   = request.path ?: "/"

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
`
}

async function cmdMockGenerate(): Promise<void> {
  console.log('Generating mock transport glue...\n')

  const config     = loadConfig()
  const mockConfig = loadMockConfig(config)
  if (!mockConfig) {
    console.error('  ✗ No mock-config schema found. Add sentinel/schemas/platform/mock-config.json')
    process.exit(1)
  }

  const mappings = mockConfig.endpoints ?? []
  if (mappings.length === 0) {
    console.warn('  ⚠ No endpoint→fixture mappings in mock-config.json — add an "endpoints" array.')
    return
  }

  let generated = 0
  const { apple, google } = config.platforms

  if (apple?.output.mock) {
    writeFile(join(config.projectRoot, apple.output.mock), genSwiftMockURLProtocol(mappings), config.projectRoot)
    console.log(`  swift  ${apple.output.mock}`)
    generated++
  }

  if (google?.output.mock) {
    writeFile(join(config.projectRoot, google.output.mock), genKotlinMockDispatcher(mappings, google.output.mock), config.projectRoot)
    console.log(`  kotlin ${google.output.mock}`)
    generated++
  }

  if (generated === 0) {
    console.warn('  ⚠ No platforms with output.mock defined in sentinel.yaml — nothing generated.')
    console.warn('  Add output.mock: path/to/MockURLProtocol.swift under the apple platform.')
  } else {
    console.log(`\n✓ Generated ${generated} mock transport file(s).`)
    console.log('  Register in your DEBUG entry point — see file header comments for instructions.')
  }
}

function cmdMockValidate(): StatusReport {
  const report = emptyReport()
  console.log('Validating fixtures against endpoint response schemas...\n')

  const config     = loadConfig()
  const mockConfig = loadMockConfig(config)
  if (!mockConfig) {
    console.error('  ✗ No mock-config schema found.')
    process.exit(1)
  }

  const all      = loadAll(config.schemasDir)
  const errors:   string[] = []
  const warnings: string[] = []
  const mappings = mockConfig.endpoints ?? []

  for (const mapping of mappings) {
    const fixtureCandidates = findFixturePathCandidates(config.projectRoot, mockConfig.fixtures ?? [], mapping.fixture)
    const fixturePath = fixtureCandidates.find((candidate) => existsSync(candidate))
    if (!fixturePath) {
      errors.push(`  ✗ Fixture not found: ${mapping.fixture}`)
      report.mocks.push({ endpoint: `${mapping.method} ${mapping.path}`, coverage: false })
      continue
    }

    let data: unknown
    try {
      data = JSON.parse(readFileSync(fixturePath, 'utf8'))
    } catch {
      errors.push(`  ✗ Invalid JSON: ${mapping.fixture}`)
      report.mocks.push({ endpoint: `${mapping.method} ${mapping.path}`, coverage: false })
      continue
    }

    // Find the endpoint schema for this path
    const endpointSchemas = all.features.filter((s) => s.content['type'] === 'endpoints')
    let matchedEndpoint: Record<string, unknown> | null = null

    for (const { content } of endpointSchemas) {
      const eps = (content['endpoints'] as Array<Record<string, unknown>>) ?? []
      const ep  = eps.find((e) => {
        const epPath = `${content['base'] ?? '/api/v1'}${e['path']}`
        return e['method'] === mapping.method && epPath === mapping.path
      })
      if (ep) { matchedEndpoint = ep; break }
    }

    if (!matchedEndpoint) {
      warnings.push(`  ⚠ No endpoint schema for ${mapping.method} ${mapping.path} — add to features/*.json`)
      continue
    }

    // Validate top-level response fields if declared inline
    const response = matchedEndpoint['response'] as Record<string, unknown> | undefined
    if (response?.fields) {
      const fields   = response.fields as Array<{ name: string; optional: boolean }>
      const required = fields.filter((f) => !f.optional).map((f) => f.name)
      const root     = typeof data === 'object' && data !== null ? data as Record<string, unknown> : {}
      for (const field of required) {
        if (!(field in root))
          errors.push(`  ✗ ${mapping.fixture}: missing required field '${field}' (${mapping.method} ${mapping.path})`)
      }
    }

    report.mocks.push({ endpoint: `${mapping.method} ${mapping.path}`, coverage: true })
    console.log(`  ✓ ${mapping.method} ${mapping.path} → ${mapping.fixture}`)
  }

  const integrationIssues = checkMockIntegration(config, mockConfig)
  for (const issue of integrationIssues) {
    if (issue.severity === 'error') {
      errors.push(`  ✗ ${issue.message}`)
      report.mocks.push({ endpoint: issue.code, coverage: false })
    } else {
      warnings.push(`  ⚠ ${issue.message}`)
    }
  }

  if (warnings.length) { console.log(''); warnings.forEach((w) => console.log(w)) }
  if (errors.length) {
    console.log('')
    errors.forEach((e) => console.error(e))
    console.log(`\n✗ ${errors.length} fixture validation error(s).`)
  } else {
    console.log(`\n✓ All ${mappings.length} fixture(s) valid.`)
  }

  return report
}

function cmdDoctor(): boolean {
  const configPath = findConfigFile(process.cwd())
  const projectRoot = configPath ? dirname(configPath) : process.cwd()
  const jsonMode = process.argv.includes('--json')
  const fixMode = process.argv.includes('--fix')
  const args = process.argv.slice(3)
  const atlasManifestPath = args.find((_, i) => args[i - 1] === '--atlas-manifest')
  const sessionIndexPath = args.find((_, i) => args[i - 1] === '--session-index')
  const brandieRoot = args.find((_, i) => args[i - 1] === '--brandie-root')
  const result = runDoctorCheck(projectRoot, SENTINEL_PACKAGE_NAME, {
    fix: fixMode,
    atlasManifestPath,
    sessionIndexPath,
    brandieRoot,
  })

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return result.passed
  }

  console.log(chalk.bold('\n  Sentinel Doctor\n'))
  if (result.fixed) {
    console.log(chalk.green('  ✓ Normalized package.json Sentinel scripts where safe\n'))
  }

  if (result.issues.length === 0) {
    console.log(chalk.green('  ✓ No install or configuration issues found\n'))
    return true
  }

  for (const issue of result.issues) {
    const prefix = issue.severity === 'error' ? chalk.red('  ✗') : chalk.yellow('  ⚠')
    console.log(`${prefix} ${chalk.dim(`[${issue.code}]`)} ${issue.message}`)
    if (issue.fix) {
      console.log(`     ${chalk.dim('fix:')} ${chalk.dim(issue.fix)}`)
    }
  }
  console.log('')
  return result.passed
}

// ---------------------------------------------------------------------------
// contracts
// ---------------------------------------------------------------------------

function cmdContracts(): StatusReport {
  console.log('Validating API contracts...')
  const report = cmdValidate()

  const config = loadConfig()
  const all    = loadAll(config.schemasDir)
  const endpointSchemas = all.features.filter((s) => s.content['type'] === 'endpoints')

  if (endpointSchemas.length === 0) {
    console.log('  No endpoint schemas found. Add type:"endpoints" schemas to sentinel/schemas/features/ to get contract validation.')
  } else {
    console.log(`  Found ${endpointSchemas.length} endpoint schema(s):`)
    for (const { content } of endpointSchemas) {
      const eps = content['endpoints'] as Array<Record<string, unknown>>
      const name = content['id'] as string
      console.log(`    ${name} — ${eps.length} endpoint(s)`)
      report.contracts.push({ name, passing: true })
    }
    console.log('  ✓ All endpoint model references valid.')
  }

  return report
}

async function cmdContractsMatrix(): Promise<StatusReport> {
  const report = emptyReport()
  const config = loadConfig()
  const { rows, result } = await buildFeatureMatrix(config)
  const activePlatforms = Object.keys(config.platforms ?? {}) as PlatformKey[]

  console.log(chalk.bold('\n  Feature matrix\n'))
  printMatrix(rows, activePlatforms)

  const failingFeatures = new Set(
    result.issues
      .filter((issue) => issue.severity === 'error' && issue.feature)
      .map((issue) => issue.feature as string),
  )

  report.contracts = rows.map((row) => ({
    name: row.feature,
    passing: !failingFeatures.has(row.feature),
  }))

  const visibleIssues = result.issues.filter((issue) => issue.severity !== 'info')
  const infoCount = result.issues.length - visibleIssues.length

  if (visibleIssues.length > 0) {
    console.log(chalk.bold('\n  Contract issues\n'))
    for (const issue of visibleIssues) {
      const prefix = issue.severity === 'error' ? chalk.red('  ✗') : chalk.yellow('  ⚠')
      const feature = issue.feature ? `${chalk.dim(`[${issue.feature}]`)} ` : ''
      console.log(`${prefix} ${feature}${issue.message}`)
      if (issue.fix) {
        console.log(`     ${chalk.dim('fix:')} ${chalk.dim(issue.fix)}`)
      }
    }
  } else {
    console.log(chalk.green('\n  ✓ Contract matrix checks passed'))
  }

  if (infoCount > 0) {
    console.log(chalk.dim(`\n  ${infoCount} info item(s) omitted`))
  }

  return report
}

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

async function cmdCatalogCapture(): Promise<void> {
  const { runCapture }     = await import('../catalog/capture.js')
  const { generateIndex }  = await import('../catalog/html.js')
  const config = loadConfig()
  if (!config.catalog) {
    console.error('No catalog: section found in sentinel.yaml. Add one to enable screen cataloguing.')
    process.exit(1)
  }

  const args = process.argv.slice(3)
  const screenFilter  = args.find((_, i) => args[i - 1] === '--screen')
  const osFilter      = args.find((_, i) => args[i - 1] === '--os') as any
  const deviceFilter  = args.find((_, i) => args[i - 1] === '--device') as any
  const variantFilter = args.find((_, i) => args[i - 1] === '--variant') as any
  const appVariant    = args.find((_, i) => args[i - 1] === '--app-variant')
  const skipExisting  = args.includes('--skip-existing')

  console.log(chalk.bold('\n  Catalog capture\n'))
  const results = await runCapture(config.catalog, config.projectRoot, {
    screenFilter, osFilter, deviceFilter, variantFilter, appVariant, skipExisting,
  })

  const ok      = results.filter((r) => r.success && !r.skipped).length
  const skipped = results.filter((r) => r.skipped).length
  const failed  = results.filter((r) => !r.success).length
  console.log(`\n  ${chalk.green(`${ok} captured`)}  ${chalk.dim(`${skipped} skipped`)}  ${failed > 0 ? chalk.red(`${failed} failed`) : ''}`)

  generateIndex(config.catalog, config.projectRoot)
  console.log(chalk.dim(`  index.html updated — open ${config.catalog.output}index.html to review`))
}

async function cmdCatalogValidate(): Promise<void> {
  const args = process.argv.slice(3)
  const atlasManifestPath = args.find((_, i) => args[i - 1] === '--atlas-manifest')
  const sessionIndexPath = args.find((_, i) => args[i - 1] === '--session-index')

  if (atlasManifestPath) {
    const atlasCompat = await import('../catalog/atlas-compat.js')
    const { validateAtlasCatalog } = await import('../catalog/atlas-validation.js')
    const manifest = atlasCompat.readJsonFixture<AtlasManifestFixture>(atlasManifestPath)
    const sessionIndex: AtlasSessionCaptureIndex = sessionIndexPath
      ? atlasCompat.readJsonFixture<AtlasSessionCaptureIndex>(sessionIndexPath)
      : {
          schemaVersion: atlasCompat.ATLAS_SESSION_INDEX_VERSION as AtlasSessionCaptureIndex['schemaVersion'],
          manifestPath: atlasManifestPath,
          captures: [],
        }
    const configPath = findConfigFile(process.cwd())
    const config = configPath ? loadConfig(configPath) : null
    const projectRoot = config?.projectRoot ?? process.cwd()
    const result = validateAtlasCatalog(manifest, sessionIndex, projectRoot)

    console.log(`\n  Atlas catalog: ${result.present}/${result.expected} expected captures present`)
    console.log(`  Diff units: ${result.comparisonUnits.filter((unit) => unit.exists).length} renderable screenshot artifact(s)`)
    console.log(`  Parity pairs: ${result.parityPairs.length}`)

    if (!result.passed) {
      const grouped = new Map<string, typeof result.issues>()
      for (const issue of result.issues) {
        const existing = grouped.get(issue.kind) ?? []
        existing.push(issue)
        grouped.set(issue.kind, existing)
      }

      for (const [kind, issues] of grouped.entries()) {
        console.log(chalk.red(`\n  ${kind} (${issues.length}):`))
        for (const issue of issues) {
          console.log(`    ✗  ${issue.message}`)
          if (issue.fix) {
            console.log(`       fix: ${issue.fix}`)
          }
        }
      }

      if (grouped.has('coverage-drift') || grouped.has('artifact-mismatch')) {
        console.log(`\n  Atlas capture next: repair the screenshot lane, then rerun sentinel catalog:index --atlas-manifest ${atlasManifestPath}${sessionIndexPath ? ` --session-index ${sessionIndexPath}` : ''}`)
      }

      if (grouped.has('review-metadata-missing')) {
        console.log(`  Brand review next: repair Atlas reviewContext or the Brandie export wiring, then rerun sentinel doctor --atlas-manifest ${atlasManifestPath}${sessionIndexPath ? ` --session-index ${sessionIndexPath}` : ''}`)
      }

      process.exit(1)
    }

    console.log(chalk.green('  ✓  All Atlas screenshot expectations are satisfied'))
    return
  }

  const { validateCatalog } = await import('../catalog/validate.js')
  const config = loadConfig()
  if (!config.catalog) {
    console.error('No catalog: section in sentinel.yaml')
    process.exit(1)
  }

  const result = validateCatalog(config.catalog, config.projectRoot)
  console.log(`\n  Catalog: ${result.present}/${result.expected} screenshots present`)

  if (result.missing.length > 0) {
    console.log(chalk.red(`\n  Missing (${result.missing.length}):`))
    for (const shot of result.missing) {
      console.log(`    ✗  ${shot.filename}`)
    }
    console.log(`\n  Run: sentinel catalog:capture`)
    process.exit(1)
  } else {
    console.log(chalk.green('  ✓  All catalog screenshots present'))
  }
}

async function cmdCatalogIndex(): Promise<void> {
  const args = process.argv.slice(3)
  const atlasManifestPath = args.find((_, i) => args[i - 1] === '--atlas-manifest')
  const sessionIndexPath = args.find((_, i) => args[i - 1] === '--session-index')
  const outputDirFlag = args.find((_, i) => args[i - 1] === '--output-dir')

  if (atlasManifestPath) {
    const { generateAtlasIndex } = await import('../catalog/html.js')
    const atlasCompat = await import('../catalog/atlas-compat.js')
    const readJsonFixture: typeof atlasCompat.readJsonFixture = atlasCompat.readJsonFixture
    const validateAtlasManifestFixture: typeof atlasCompat.validateAtlasManifestFixture = atlasCompat.validateAtlasManifestFixture
    const validateAtlasSessionCaptureIndex: typeof atlasCompat.validateAtlasSessionCaptureIndex = atlasCompat.validateAtlasSessionCaptureIndex
    const validateAtlasFixtureSet: typeof atlasCompat.validateAtlasFixtureSet = atlasCompat.validateAtlasFixtureSet

    const manifest = readJsonFixture<AtlasManifestFixture>(atlasManifestPath)
    validateAtlasManifestFixture(manifest, atlasManifestPath)

    const sessionIndex: AtlasSessionCaptureIndex = sessionIndexPath
      ? readJsonFixture<AtlasSessionCaptureIndex>(sessionIndexPath)
      : {
          schemaVersion: atlasCompat.ATLAS_SESSION_INDEX_VERSION as AtlasSessionCaptureIndex['schemaVersion'],
          manifestPath: atlasManifestPath,
          captures: [],
        }

    validateAtlasSessionCaptureIndex(sessionIndex, sessionIndexPath ?? 'generated empty atlas session index')
    validateAtlasFixtureSet(manifest, sessionIndex, 'catalog:index atlas input')

    const configPath = findConfigFile(process.cwd())
    const config = configPath ? loadConfig(configPath) : null
    const projectRoot = config?.projectRoot ?? process.cwd()
    const outputDir = outputDirFlag
      ? resolve(process.cwd(), outputDirFlag)
      : config?.catalog
        ? resolve(config.projectRoot, config.catalog.output)
        : resolve(process.cwd(), 'catalog')

    generateAtlasIndex(outputDir, projectRoot, manifest, sessionIndex)
    console.log(chalk.green(`  ✓  ${relative(projectRoot, join(outputDir, 'index.html')) || 'catalog/index.html'} generated`))
    return
  }

  const { generateIndex } = await import('../catalog/html.js')
  const config = loadConfig()
  if (!config.catalog) {
    console.error('No catalog: section in sentinel.yaml')
    process.exit(1)
  }
  generateIndex(config.catalog, config.projectRoot)
  console.log(chalk.green(`  ✓  ${config.catalog.output}index.html generated`))
}

async function cmdCatalogUpload(): Promise<void> {
  const { runUpload, validateUploadOptions } = await import('../catalog/upload.js')
  const { generateIndex } = await import('../catalog/html.js')
  const config = loadConfig()
  if (!config.catalog) {
    console.error('No catalog: section in sentinel.yaml')
    process.exit(1)
  }

  // Parse flags + trailing file path
  // Strategy: collect all flag values, then remaining non-flag args are positional (the file)
  const args = process.argv.slice(3)
  const flag = (name: string) => args.find((_, i) => args[i - 1] === `--${name}`)
  const consumed = new Set<number>()
  args.forEach((a, i) => {
    if (a.startsWith('--')) { consumed.add(i); consumed.add(i + 1) }
  })
  const positionals = args.filter((_, i) => !consumed.has(i))
  const file = positionals.at(-1)

  const opts = {
    screen:  flag('screen'),
    os:      flag('os') as any,
    device:  flag('device') as any,
    variant: flag('variant') as any,
    scroll:  flag('scroll') ? Number(flag('scroll')) : undefined,
    file:    file ?? '',
  }

  const errors = validateUploadOptions(opts, config.catalog)
  if (errors.length > 0) {
    console.error(chalk.red('\n  Upload failed:\n'))
    errors.forEach((e) => console.error(`    ✗  ${e}`))
    console.error(chalk.dim('\n  Usage: sentinel catalog:upload --screen <slug> --os <ios18|ios26|android|watchos|tvos> --device <iphone|ipad|phone|tablet|watch|tv> --variant <light|dark|glossy-light|glossy-dark> [--scroll <N>] <file>\n'))
    process.exit(1)
  }

  console.log(chalk.bold('\n  Catalog upload\n'))
  const ok = runUpload(config.catalog, config.projectRoot, opts as any)
  if (!ok) process.exit(1)

  generateIndex(config.catalog, config.projectRoot)
  console.log(chalk.dim(`  index.html updated`))
}

// ---------------------------------------------------------------------------
// registry:scan
// ---------------------------------------------------------------------------

function cmdRegistryScan(): void {
  const config = loadConfig()
  if (!config.catalog) {
    console.error('No catalog: section in sentinel.yaml — add one to enable the screen registry.')
    process.exit(1)
  }

  const args       = process.argv.slice(3)
  const fileArg    = args.find((_, i) => args[i - 1] === '--file')
  const jsonMode   = args.includes('--json')
  const warnMode   = args.includes('--warn') // exit 0 even if unregistered (for hooks)

  const result = scanRegistry(config.catalog, config.projectRoot, fileArg)

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    if (result.unregistered.length > 0 && !warnMode) process.exit(1)
    return
  }

  if (fileArg) {
    // Single-file mode: used by the sentinel-registry hook
    if (result.unregistered.length === 0) {
      // File is registered (or not a screen file) — silent
      return
    }
    const { suggestedSlug } = result.unregistered[0]
    console.error(`\nScreen not registered in sentinel.yaml: ${fileArg}`)
    console.error(`\nAdd this entry to the screens: list in sentinel.yaml:\n`)
    console.error(`  - slug: ${suggestedSlug}`)
    console.error(`    name: [Screen Name]`)
    console.error(`    # flow: sentinel/flows/catalog/${suggestedSlug}.yaml  (add when Maestro flow is ready)`)
    console.error(`\nThen run: npx sentinel catalog:capture --screen ${suggestedSlug}`)
    if (!warnMode) process.exit(1)
    return
  }

  // Full scan mode
  const { registeredCount, foundCount, unregistered } = result
  console.log(chalk.bold('\n  Registry scan\n'))
  console.log(`  ${foundCount} screen file(s) found   ${registeredCount} registered in sentinel.yaml`)

  if (unregistered.length === 0) {
    console.log(chalk.green('\n  ✓  All screens registered'))
    return
  }

  console.log(chalk.yellow(`\n  Unregistered (${unregistered.length}):\n`))
  for (const { file, suggestedSlug } of unregistered) {
    console.log(`  ✗  ${file}`)
    console.log(chalk.dim(`     → suggested slug: ${suggestedSlug}`))
  }

  console.log(chalk.dim('\n  Add each unregistered screen to sentinel.yaml:'))
  console.log(chalk.dim('  screens:'))
  for (const { suggestedSlug } of unregistered) {
    console.log(chalk.dim(`    - slug: ${suggestedSlug}`))
    console.log(chalk.dim(`      name: [Screen Name]`))
  }

  if (!warnMode) process.exit(1)
}

// ---------------------------------------------------------------------------
// quality:check
// ---------------------------------------------------------------------------

async function cmdQualityCheck(): Promise<boolean> {
  const config = loadConfig()
  const jsonMode = process.argv.includes('--json')

  if (!config.quality) {
    if (jsonMode) {
      process.stdout.write(JSON.stringify({ error: 'No quality block in sentinel.yaml' }, null, 2) + '\n')
    } else {
      console.error(chalk.red('  ✗ No quality block in sentinel.yaml'))
      console.error(chalk.dim('  Add a quality: section to enable code quality checks'))
    }
    process.exit(1)
  }

  const result = await checkQuality(config.projectRoot, config.quality)

  if (jsonMode) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
    return result.passed
  }

  console.log(chalk.bold.white('\n  Sentinel — Quality Check\n'))

  if (result.issues.length === 0) {
    console.log(chalk.green('  ✓') + ` All ${result.checkedCount} quality checks passed` + chalk.dim(` (${result.durationMs}ms)`))
  } else {
    const errors = result.issues.filter(i => i.severity === 'error')
    const warnings = result.issues.filter(i => i.severity === 'warning')

    for (const issue of result.issues) {
      const prefix = issue.severity === 'error' ? chalk.red('  ✗') : chalk.yellow('  ⚠')
      console.log(`${prefix} ${chalk.dim(`[${issue.rule}]`)} ${issue.message}`)
      if (issue.fix) {
        console.log(`     ${chalk.dim('fix:')} ${chalk.dim(issue.fix)}`)
      }
    }

    console.log()
    if (errors.length > 0) {
      console.log(chalk.red(`  ✗ ${errors.length} error${errors.length !== 1 ? 's' : ''}`) + (warnings.length > 0 ? chalk.yellow(`, ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`) : ''))
    } else {
      console.log(chalk.yellow(`  ⚠ ${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`))
    }
  }

  const errorCount = result.issues.filter(i => i.severity === 'error').length
  const warnCount = result.issues.filter(i => i.severity === 'warning').length
  const scanned = result.filesScanned ?? 0
  console.log(chalk.dim(`\n  ${scanned} files scanned, ${result.checkedCount} checks, ${errorCount} errors, ${warnCount} warnings\n`))

  return result.passed
}

// ---------------------------------------------------------------------------
// design:validate — design-token drift + no-hardcoded-values gate
// ---------------------------------------------------------------------------

function cmdDesignValidate(): boolean {
  const config = loadConfig()
  // Reuse the hash-based staleness check for token drift; add the hardcoded-token lint.
  const results = [checkStaleness(config), lintHardcodedTokens(config)]
  let ok = true
  for (const r of results) {
    const errs = r.issues.filter((i) => i.severity === 'error')
    if (r.issues.length === 0) {
      console.log(chalk.green(`✓ ${r.layer}: ${r.checkedCount} checked, clean (${r.durationMs}ms)`))
    } else {
      for (const issue of r.issues) {
        const tag = issue.severity === 'error' ? chalk.red('error') : chalk.yellow('warn ')
        console.log(`  ${tag} [${issue.layer}/${issue.rule}] ${issue.file}: ${issue.message}`)
      }
      if (errs.length) ok = false
    }
  }
  console.log(ok ? chalk.green('✓ design:validate passed') : chalk.red('✗ design:validate failed'))
  return ok
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

const cmd = process.argv[2]
const writeStatusPath = parseWriteStatus();
const usage = 'Usage: sentinel schema:validate | schema:generate | contracts | contracts:matrix | mock:generate | mock:validate | catalog:capture [--app-variant <name>] | catalog:validate [--atlas-manifest <file> --session-index <file>] | catalog:index [--atlas-manifest <file> --session-index <file> --output-dir <dir>] | catalog:upload | atlas:import | atlas:export | atlas:migrate | registry:scan | design:validate | quality:check [--file <path>] [--json] [--warn] | doctor [--fix] [--json] [--atlas-manifest <file> --session-index <file> --brandie-root <dir>] | all';

(async () => {
  let report: StatusReport | null = null

  switch (cmd) {
    case '--help':
    case '-h': console.log(usage); break
    case '--version':
    case '-v': {
      const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
      console.log(pkg.version)
      break
    }
    case 'schema:validate':  report = cmdValidate(); break
    case 'schema:generate':  await cmdGenerate(); break
    case 'contracts':        report = cmdContracts(); break
    case 'contracts:matrix': report = await cmdContractsMatrix(); break
    case 'mock:generate':    await cmdMockGenerate(); break
    case 'mock:validate':    report = cmdMockValidate(); break
    case 'catalog:capture':  await cmdCatalogCapture(); break
    case 'catalog:validate': await cmdCatalogValidate(); break
    case 'catalog:index':    await cmdCatalogIndex(); break
    case 'catalog:upload':   await cmdCatalogUpload(); break
    case 'atlas:import':     cmdAtlasImport(); break
    case 'atlas:export':     cmdAtlasExport(); break
    case 'atlas:migrate':    cmdAtlasMigrate(); break
    case 'registry:scan':    cmdRegistryScan(); break
    case 'design:validate': { const passed = cmdDesignValidate(); if (!passed) process.exit(1); break }
    case 'quality:check': {
      const passed = await cmdQualityCheck()
      if (!passed) process.exit(1)
      break
    }
    case 'doctor': {
      const passed = cmdDoctor()
      if (!passed) process.exit(1)
      break
    }
    case 'all': {
      report = cmdValidate()
      await cmdGenerate()
      await cmdMockGenerate()
      break
    }
    default:
      console.error(`Unknown command: ${cmd ?? '(none)'}`)
      console.error(usage)
      process.exit(1)
    }

  if (writeStatusPath && report) {
    writeStatusFile(writeStatusPath, report)
  }

  // Deferred exit for validation failures
  if (report) {
    const hasSchemaErrors = report.schemas.some((s) => !s.valid)
    const hasContractErrors = report.contracts.some((c) => !c.passing)
    const hasMockErrors = report.mocks.some((m) => !m.coverage)
    if (hasSchemaErrors || hasContractErrors || hasMockErrors) process.exit(1)
  }
})().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
