/**
 * Google (Kotlin) navigation generator.
 * Reads sentinel/schemas/platform/navigation.json → AppRoutes.kt with route constants.
 */
import path from 'path'
import type { ResolvedConfig, NavigationSchema, NavigationRoute } from '../../../config/types.js'
import { readJSON, writeFile, generatedHeader, hashFile, fileExists } from '../../../utils/file.js'
import { log } from '../../../utils/logger.js'

export function generateGoogleNavigation(config: ResolvedConfig): void {
  const platform = config.platforms.google
  const navOutput = (platform?.output as Record<string, unknown>)?.navigation as string | undefined
  if (!navOutput) return

  const navPath = path.join(config.platformDir, 'navigation.json')
  if (!fileExists(navPath)) {
    log.dim('Google navigation — navigation.json not found, skipping')
    return
  }

  const nav = readJSON<NavigationSchema>(navPath)
  const googleRoutes = nav.routes.filter(r => r.platforms.google)
  const pkg = derivePackage(navOutput)

  const output = [
    generatedHeader('sentinel/generators/google/navigation', 'sentinel/schemas/platform/navigation.json', hashFile(navPath)),
    `package ${pkg}`,
    ``,
    `@Suppress("unused")`,
    generateRouteObject(googleRoutes, nav),
  ].join('\n')

  writeFile(navOutput, output)
  log.success(`Google navigation → ${navOutput}`)
}

function generateRouteObject(routes: NavigationRoute[], nav: NavigationSchema): string {
  const lines = [
    `/** Auto-generated route constants. Use in NavHost destinations. */`,
    `object AppRoutes {`,
  ]

  for (const route of routes) {
    const constName = idToScreamingSnake(route.id)
    const platform = route.platforms.google
    const file = platform?.file ?? 'TBD'
    lines.push(`    /** View: ${file}. Auth: ${route.auth ? 'required' : 'none'} */`)
    lines.push(`    const val ${constName} = "${route.id}"`)
    if (route.deepLink) {
      lines.push(`    const val ${constName}_DEEP_LINK = "${route.deepLink}"`)
    }
  }

  if (nav.tabs && nav.tabs.length > 0) {
    lines.push(``)
    lines.push(`    /** Tab identifiers */`)
    for (const tab of nav.tabs) {
      const constName = idToScreamingSnake(tab.id)
      lines.push(`    const val TAB_${constName} = "${tab.id}"  // ${tab.label}`)
    }
  }

  lines.push(`}`)
  return lines.join('\n')
}

// "workout-log" → "WORKOUT_LOG"
function idToScreamingSnake(id: string): string {
  return id.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()
}

function derivePackage(outputPath: string): string {
  const match = outputPath.match(/kotlin[/\\](.+)[/\\][^/\\]+\.kt$/)
  if (!match) return 'com.app.navigation'
  return match[1].replace(/[/\\]/g, '.')
}
