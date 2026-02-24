import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { ensureSentinelDir } from '../config/loader.js'
import { log } from '../utils/logger.js'

export async function initProject(projectName: string): Promise<void> {
  const cwd = process.cwd()
  const configPath = path.join(cwd, 'sentinel.yaml')

  if (fs.existsSync(configPath)) {
    log.warn('sentinel.yaml already exists — skipping')
    return
  }

  // Scaffold sentinel.yaml
  const config = {
    sentinel: '1.0',
    project: projectName,
    version: '1.0.0',
    location: './sentinel',
    platforms: {
      api: {
        path: './backend',
        language: 'typescript',
        framework: 'nestjs',
      },
      apple: {
        path: './apple',
        language: 'swift',
        output: {
          tokens:  `./apple/${capitalize(projectName)}/DesignSystem/Tokens/${capitalize(projectName)}Tokens.swift`,
          strings: `./apple/${capitalize(projectName)}/Resources/Strings.swift`,
          flags:   `./apple/${capitalize(projectName)}/Core/FeatureFlags.swift`,
        },
      },
      google: {
        path: './google',
        language: 'kotlin',
        output: {
          tokens:  `./google/app/src/main/kotlin/com/${projectName.toLowerCase()}/design/${capitalize(projectName)}Tokens.kt`,
          strings: `./google/app/src/main/res/values/strings.xml`,
          flags:   `./google/app/src/main/kotlin/com/${projectName.toLowerCase()}/core/FeatureFlags.kt`,
        },
      },
    },
    chaos: {
      targets: {
        api: 'http://localhost:3000',
      },
    },
  }

  fs.writeFileSync(configPath, yaml.dump(config, { lineWidth: 120 }), 'utf-8')
  log.success('Created sentinel.yaml')

  // Scaffold sentinel/ directory structure
  const sentinelDir = path.join(cwd, 'sentinel')
  ensureSentinelDir(sentinelDir)
  log.success('Created sentinel/ directory structure')

  // Scaffold example schemas
  scaffoldExampleSchemas(sentinelDir, projectName)

  log.blank()
  log.info('Next steps:')
  log.info('  1. Edit sentinel.yaml — adjust platform paths and output locations')
  log.info('  2. Fill in sentinel/schemas/design/tokens.json with your design tokens')
  log.info('  3. Fill in sentinel/schemas/design/strings.json with your copy')
  log.info('  4. Add feature schemas to sentinel/schemas/features/')
  log.info('  5. Add model schemas to sentinel/schemas/models/')
  log.info('  6. Run "sentinel schema:generate" to generate platform files')
  log.blank()
}

function scaffoldExampleSchemas(sentinelDir: string, projectName: string): void {
  const tokensPath = path.join(sentinelDir, 'schemas', 'design', 'tokens.json')
  const stringsPath = path.join(sentinelDir, 'schemas', 'design', 'strings.json')
  const flagsPath = path.join(sentinelDir, 'schemas', 'platform', 'feature-flags.json')
  const navPath = path.join(sentinelDir, 'schemas', 'platform', 'navigation.json')
  const exampleFeaturePath = path.join(sentinelDir, 'schemas', 'features', '_example.json')
  const exampleModelPath = path.join(sentinelDir, 'schemas', 'models', '_example-status.json')

  if (!fs.existsSync(tokensPath)) {
    fs.writeFileSync(tokensPath, JSON.stringify({
      $sentinel: '1.0',
      type: 'tokens',
      version: '1.0.0',
      colors: {
        brand: {
          primary: { value: '#000000', description: 'Primary brand colour' },
        },
        semantic: {
          background: {
            primary: { value: '#FFFFFF', description: 'Main background' },
          },
          text: {
            primary: { value: '#000000', description: 'Primary text' },
          },
        },
      },
      typography: {
        fontSizes: {
          sm:   { value: '14px' },
          base: { value: '16px' },
          lg:   { value: '20px' },
          xl:   { value: '24px' },
        },
        fontWeights: {
          regular:  { value: '400' },
          semibold: { value: '600' },
          bold:     { value: '700' },
        },
        lineHeights: {
          tight:  { value: '1.25' },
          normal: { value: '1.5' },
        },
      },
      spacing: {
        1: { value: '4px' },
        2: { value: '8px' },
        3: { value: '12px' },
        4: { value: '16px' },
        6: { value: '24px' },
        8: { value: '32px' },
      },
      borderRadius: {
        sm:   { value: '4px' },
        md:   { value: '8px' },
        lg:   { value: '12px' },
        full: { value: '9999px' },
      },
      animation: {
        duration: {
          fast: { value: '150ms' },
          base: { value: '300ms' },
          slow: { value: '500ms' },
        },
      },
    }, null, 2))
    log.success('Created sentinel/schemas/design/tokens.json (example)')
  }

  if (!fs.existsSync(stringsPath)) {
    fs.writeFileSync(stringsPath, JSON.stringify({
      $sentinel: '1.0',
      type: 'strings',
      version: '1.0.0',
      locales: ['en'],
      strings: {
        'common.ok': 'OK',
        'common.cancel': 'Cancel',
        'common.save': 'Save',
        'common.delete': 'Delete',
        'common.loading': 'Loading…',
        'common.error.generic': 'Something went wrong. Please try again.',
      },
    }, null, 2))
    log.success('Created sentinel/schemas/design/strings.json (example)')
  }

  if (!fs.existsSync(flagsPath)) {
    fs.writeFileSync(flagsPath, JSON.stringify({
      $sentinel: '1.0',
      type: 'feature-flags',
      version: '1.0.0',
      flags: [
        {
          key: 'EXAMPLE_FEATURE',
          description: 'Example feature flag — replace with your own',
          defaultEnabled: false,
          platforms: ['apple', 'google', 'web'],
          milestone: 1,
        },
      ],
    }, null, 2))
    log.success('Created sentinel/schemas/platform/feature-flags.json (example)')
  }

  if (!fs.existsSync(navPath)) {
    fs.writeFileSync(navPath, JSON.stringify({
      $sentinel: '1.0',
      type: 'navigation',
      version: '1.0.0',
      tabs: [],
      routes: [],
    }, null, 2))
    log.success('Created sentinel/schemas/platform/navigation.json (example)')
  }

  if (!fs.existsSync(exampleModelPath)) {
    fs.writeFileSync(exampleModelPath, JSON.stringify({
      $sentinel: '1.0',
      type: 'model',
      id: 'example-status',
      name: 'ExampleStatus',
      description: 'Example enum model — replace with your own',
      isEnum: true,
      platforms: ['api', 'apple', 'google'],
      enumValues: [
        { name: 'active', rawValue: 'active' },
        { name: 'completed', rawValue: 'completed' },
        { name: 'archived', rawValue: 'archived' },
      ],
    }, null, 2))
    log.success('Created sentinel/schemas/models/_example-status.json (example)')
  }

  if (!fs.existsSync(exampleFeaturePath)) {
    fs.writeFileSync(exampleFeaturePath, JSON.stringify({
      $sentinel: '1.0',
      type: 'feature',
      id: 'example-feature',
      name: 'Example Feature',
      milestone: 1,
      status: 'planned',
      tier: 'free',
      platforms: {
        api: {
          status: 'planned',
          endpoints: ['GET /example'],
        },
        apple: {
          status: 'planned',
          screens: ['ExampleView'],
        },
        google: {
          status: 'planned',
          screens: ['ExampleScreen'],
        },
      },
      flags: ['EXAMPLE_FEATURE'],
      strings: ['common.ok'],
    }, null, 2))
    log.success('Created sentinel/schemas/features/_example.json (example)')
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
