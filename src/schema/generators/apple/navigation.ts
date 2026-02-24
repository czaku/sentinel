/**
 * Apple (Swift) navigation generator.
 * Reads sentinel/schemas/platform/navigation.json → AppRoutes.swift with enum cases.
 */
import path from 'path'
import type { ResolvedConfig, NavigationSchema, NavigationRoute } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, hashFile, fileExists } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateAppleNavigation(config: ResolvedConfig): void {
  const platform = config.platforms.apple
  const navOutput = (platform?.output as Record<string, unknown>)?.navigation as string | undefined
  if (!navOutput) return

  const navPath = path.join(config.platformDir, 'navigation.json')
  if (!fileExists(navPath)) {
    log.dim('Apple navigation — navigation.json not found, skipping')
    return
  }

  const nav = readJSON<NavigationSchema>(navPath)
  const appleRoutes = nav.routes.filter(r => r.platforms.apple)

  const output = [
    generatedHeader('sentinel/generators/apple/navigation', 'sentinel/schemas/platform/navigation.json', hashFile(navPath)),
    `import Foundation`,
    ``,
    `// swiftlint:disable all`,
    generateRouteEnum(appleRoutes),
    ``,
    generateDeepLinkMap(appleRoutes),
    generateTabConstants(nav),
    `// swiftlint:enable all`,
  ].filter(Boolean).join('\n')

  writeFile(navOutput, output)
  log.success(`Apple navigation → ${navOutput}`)
}

function generateRouteEnum(routes: NavigationRoute[]): string {
  if (routes.length === 0) return ''

  const lines = [
    `/// Auto-generated route identifiers. Use these in NavigationLink / programmatic navigation.`,
    `public enum AppRoute: String, Hashable, CaseIterable {`,
  ]

  for (const route of routes) {
    const caseName = pathToCamel(route.id)
    const platform = route.platforms.apple
    const status = platform?.status ?? 'planned'
    const file = platform?.file ?? 'TBD'
    if (route.auth) {
      lines.push(`    /// Auth required. View: ${file}. Status: ${status}`)
    } else {
      lines.push(`    /// View: ${file}. Status: ${status}`)
    }
    lines.push(`    case ${caseName} = "${route.id}"`)
  }
  lines.push(`}`)
  return lines.join('\n')
}

function generateDeepLinkMap(routes: NavigationRoute[]): string {
  const withDeepLinks = routes.filter(r => r.deepLink)
  if (withDeepLinks.length === 0) return ''

  const lines = [
    `public extension AppRoute {`,
    `    /// Deep link URL path → AppRoute mapping`,
    `    static func from(deepLink path: String) -> AppRoute? {`,
    `        switch path {`,
  ]
  for (const route of withDeepLinks) {
    const caseName = pathToCamel(route.id)
    lines.push(`        case "${route.deepLink}": return .${caseName}`)
  }
  lines.push(`        default: return nil`)
  lines.push(`        }`)
  lines.push(`    }`)
  lines.push(`}`)
  lines.push(``)
  return lines.join('\n')
}

function generateTabConstants(nav: NavigationSchema): string {
  if (!nav.tabs || nav.tabs.length === 0) return ''

  const lines = [
    `/// Tab bar configuration`,
    `public enum AppTab: String, CaseIterable {`,
  ]
  for (const tab of nav.tabs) {
    const caseName = tab.id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    lines.push(`    case ${caseName} = "${tab.id}" // ${tab.label}`)
  }
  lines.push(`}`)
  return lines.join('\n')
}

// "workout-log" → "workoutLog"
function pathToCamel(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^[A-Z]/, c => c.toLowerCase())
}
