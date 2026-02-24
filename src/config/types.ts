// ─── Sentinel Config Types ────────────────────────────────────────────────────
// These map directly to sentinel.yaml in each adopting project.

export type SentinelVersion = '1.0'

export type Language = 'typescript' | 'python' | 'swift' | 'kotlin' | 'go'
export type Framework = 'nestjs' | 'fastapi' | 'express' | 'nextjs' | 'nuxt' | 'rails'
export type PlatformKey = 'api' | 'apple' | 'google' | 'web' | 'web-admin' | 'desktop'

// ─── Platform Configs ─────────────────────────────────────────────────────────

export interface ApiPlatformConfig {
  path: string
  language: Language
  framework?: Framework
  openapi?: string           // path to openapi.json, or sentinel auto-discovers
}

export interface ApplePlatformConfig {
  path: string
  language: 'swift'
  output: {
    tokens: string
    strings: string
    flags: string
    models?: string
  }
}

export interface GooglePlatformConfig {
  path: string
  language: 'kotlin'
  output: {
    tokens: string
    strings: string
    flags: string
    models?: string
  }
}

export interface WebPlatformConfig {
  path: string
  language: 'typescript'
  framework?: Framework
  output: {
    tokens: string
    strings: string
    flags: string
    models?: string
  }
}

export type PlatformConfig =
  | ApiPlatformConfig
  | ApplePlatformConfig
  | GooglePlatformConfig
  | WebPlatformConfig

// ─── Chaos Config ─────────────────────────────────────────────────────────────

export interface ChaosConfig {
  targets: Partial<Record<PlatformKey, string>>   // e.g. api: http://localhost:3000
}

// ─── Notification Config ──────────────────────────────────────────────────────

export interface NotificationsConfig {
  github_issues?: boolean
  on_failure?: Array<'schema' | 'contracts' | 'chaos' | 'visual' | 'perf' | 'flows'>
}

// ─── Root Config ──────────────────────────────────────────────────────────────

export interface SentinelConfig {
  sentinel: SentinelVersion
  project: string
  version: string

  // Path to the /sentinel/ directory in the adopting project.
  // Internal structure is fixed — not configurable.
  // Default: ./sentinel
  location?: string

  platforms: Partial<{
    api: ApiPlatformConfig
    apple: ApplePlatformConfig
    google: GooglePlatformConfig
    web: WebPlatformConfig
    'web-admin': WebPlatformConfig
    desktop: ApplePlatformConfig
  }>

  chaos?: ChaosConfig
  notifications?: NotificationsConfig
}

// ─── Resolved Config (post-load, all paths absolute) ─────────────────────────

export interface ResolvedConfig extends SentinelConfig {
  projectRoot: string       // absolute path to the project root
  sentinelDir: string       // absolute path to ./sentinel/
  schemasDir: string        // sentinelDir/schemas/
  featuresDir: string       // schemasDir/features/
  designDir: string         // schemasDir/design/
  platformDir: string       // schemasDir/platform/
}

// ─── Internal Schema Types ────────────────────────────────────────────────────
// These describe the JSON files inside sentinel/schemas/

export type FeatureStatus = 'planned' | 'in-progress' | 'shipped' | 'deprecated'
export type FeatureTier = 'free' | 'tracker' | 'social' | 'pro'

export interface PlatformFeatureStatus {
  status: FeatureStatus
  screens?: string[]         // view/screen names on this platform
  endpoints?: string[]       // API endpoint paths (api platform)
  since?: string             // version when shipped
}

export interface FeatureSchema {
  $sentinel: SentinelVersion
  type: 'feature'
  id: string
  name: string
  milestone: number
  status: FeatureStatus
  tier: FeatureTier
  platforms: Partial<Record<PlatformKey, PlatformFeatureStatus>>
  flags?: string[]           // feature flag keys that gate this feature
  dependencies?: string[]    // other feature IDs this depends on
  strings?: string[]         // string keys this feature uses
  models?: string[]          // model names this feature uses
}

export interface TokensSchema {
  $sentinel: SentinelVersion
  type: 'tokens'
  version: string
  colors: Record<string, unknown>
  typography: Record<string, unknown>
  spacing: Record<string, unknown>
  borderRadius?: Record<string, unknown>
  animation?: Record<string, unknown>
  shadows?: Record<string, unknown>
}

export interface StringsSchema {
  $sentinel: SentinelVersion
  type: 'strings'
  version: string
  locales: string[]
  strings: Record<string, string | Record<string, string>>  // key → value or key → { locale: value }
}

export interface FeatureFlagsSchema {
  $sentinel: SentinelVersion
  type: 'feature-flags'
  version: string
  flags: FeatureFlagEntry[]
}

export interface FeatureFlagEntry {
  key: string
  description?: string
  defaultEnabled: boolean
  platforms: PlatformKey[]
  milestone?: number
  tier?: FeatureTier
}

export interface NavigationSchema {
  $sentinel: SentinelVersion
  type: 'navigation'
  version: string
  tabs?: NavigationTab[]
  routes: NavigationRoute[]
  modals?: NavigationModal[]
}

export interface NavigationTab {
  id: string
  label: string
  icon: string
  initialRoute: string
}

export interface NavigationRoute {
  id: string
  path: string
  deepLink?: string
  platforms: Partial<Record<PlatformKey, { file: string; status: FeatureStatus }>>
  feature?: string           // feature ID that owns this route
  auth?: boolean
}

export interface NavigationModal {
  id: string
  presentation: 'sheet' | 'fullScreen' | 'overlay' | 'popover'
  platforms: Partial<Record<PlatformKey, { file: string }>>
}

// ─── Validation Result Types ──────────────────────────────────────────────────

export type IssueSeverity = 'error' | 'warning' | 'info'

export interface ValidationIssue {
  severity: IssueSeverity
  layer: string              // schema | contracts | chaos | visual | perf | flows
  rule: string               // drift | parity | staleness | orphan-endpoint | etc.
  platform?: PlatformKey
  feature?: string
  file?: string
  message: string
  fix?: string               // suggested fix
}

export interface ValidationResult {
  layer: string
  passed: boolean
  issues: ValidationIssue[]
  durationMs: number
  checkedCount: number
}

export interface SentinelReport {
  project: string
  version: string
  timestamp: string
  passed: boolean
  results: ValidationResult[]
  summary: {
    total: number
    errors: number
    warnings: number
    infos: number
  }
}
