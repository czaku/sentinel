import type { ResolvedConfig, ValidationResult } from '../config/types.js'
import { generateAppleTokens } from './generators/apple/tokens.js'
import { generateAppleStrings } from './generators/apple/strings.js'
import { generateAppleFlags } from './generators/apple/flags.js'
import { generateAppleModels } from './generators/apple/models.js'
import { generateAppleNavigation } from './generators/apple/navigation.js'
import { generateGoogleTokens } from './generators/google/tokens.js'
import { generateGoogleStrings } from './generators/google/strings.js'
import { generateGoogleFlags } from './generators/google/flags.js'
import { generateGoogleModels } from './generators/google/models.js'
import { generateGoogleNavigation } from './generators/google/navigation.js'
import { generateWebTokens } from './generators/web/tokens.js'
import { generateWebStrings } from './generators/web/strings.js'
import { generateWebFlags } from './generators/web/flags.js'
import { detectDrift } from './validators/drift.js'
import { checkStaleness } from './validators/staleness.js'
import { checkCompleteness } from './validators/completeness.js'
import { log } from '../utils/logger.js'

export async function generateAll(config: ResolvedConfig): Promise<void> {
  log.header('Generating platform files')
  log.rule()

  if (config.platforms.apple) {
    generateAppleTokens(config)
    generateAppleStrings(config)
    generateAppleFlags(config)
    generateAppleModels(config)
    generateAppleNavigation(config)
  }

  if (config.platforms.google) {
    generateGoogleTokens(config)
    generateGoogleStrings(config)
    generateGoogleFlags(config)
    generateGoogleModels(config)
    generateGoogleNavigation(config)
  }

  if (config.platforms.web || config.platforms['web-admin']) {
    generateWebTokens(config)
    generateWebStrings(config)
    generateWebFlags(config)
  }
}

export async function validateAll(config: ResolvedConfig): Promise<ValidationResult[]> {
  log.header('Validating schemas')
  log.rule()

  const [completeness, drift, staleness] = await Promise.all([
    checkCompleteness(config),
    detectDrift(config),
    Promise.resolve(checkStaleness(config)),
  ])

  return [completeness, drift, staleness]
}
