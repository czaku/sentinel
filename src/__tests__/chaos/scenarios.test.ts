import { describe, it, expect } from 'vitest'
import { CorruptJsonScenario, EmptyCollectionScenario, LargePayloadScenario } from '../../chaos/scenarios/data.js'
import { CardDeclinedScenario, SubscriptionExpiredScenario, WebhookMissingScenario } from '../../chaos/scenarios/payment.js'
import { ClockSkewScenario, LowStorageScenario, BackgroundKillScenario } from '../../chaos/scenarios/platform.js'
import { ExpiredTokenScenario, NoTokenScenario } from '../../chaos/scenarios/auth.js'

describe('Chaos scenario structure', () => {
  it('all scenarios have id, description, and run function', () => {
    const scenarios = [
      new CorruptJsonScenario(),
      new EmptyCollectionScenario(),
      new LargePayloadScenario(),
      new CardDeclinedScenario(),
      new SubscriptionExpiredScenario(),
      new WebhookMissingScenario(),
      new ClockSkewScenario(),
      new LowStorageScenario(),
      new BackgroundKillScenario(),
      new ExpiredTokenScenario(),
      new NoTokenScenario(),
    ]

    for (const scenario of scenarios) {
      expect(scenario.id, `${scenario.id} missing id`).toBeTruthy()
      expect(scenario.description, `${scenario.id} missing description`).toBeTruthy()
      expect(typeof scenario.run, `${scenario.id} run not a function`).toBe('function')
    }
  })

  it('all scenario IDs are unique', () => {
    const scenarios = [
      new CorruptJsonScenario(),
      new EmptyCollectionScenario(),
      new LargePayloadScenario(),
      new CardDeclinedScenario(),
      new SubscriptionExpiredScenario(),
      new WebhookMissingScenario(),
      new ClockSkewScenario(),
      new LowStorageScenario(),
      new BackgroundKillScenario(),
      new ExpiredTokenScenario(),
      new NoTokenScenario(),
    ]
    const ids = scenarios.map(s => s.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })
})

describe('Chaos scenarios — graceful skip when no target config', () => {
  it('EmptyCollectionScenario skips with no validToken', async () => {
    const scenario = new EmptyCollectionScenario()
    const result = await scenario.run({ target: 'http://localhost:99999' })
    expect(result.passed).toBe(true)
    expect(result.observations[0]).toContain('skipped')
  })

  it('CardDeclinedScenario skips with no pastDueToken', async () => {
    const scenario = new CardDeclinedScenario()
    const result = await scenario.run({ target: 'http://localhost:99999' })
    expect(result.passed).toBe(true)
    expect(result.observations[0]).toContain('skipped')
  })

  it('LowStorageScenario skips without platformRunner', async () => {
    const scenario = new LowStorageScenario()
    const result = await scenario.run({ target: 'http://localhost:99999' })
    expect(result.passed).toBe(true)
    expect(result.observations[0]).toContain('Skipped')
  })

  it('BackgroundKillScenario skips without platformRunner', async () => {
    const scenario = new BackgroundKillScenario()
    const result = await scenario.run({ target: 'http://localhost:99999' })
    expect(result.passed).toBe(true)
    expect(result.observations[0]).toContain('Skipped')
  })

  it('NoTokenScenario skips with no protectedEndpoints', async () => {
    const scenario = new NoTokenScenario()
    const result = await scenario.run({ target: 'http://localhost:99999' })
    expect(result.passed).toBe(true)
    expect(result.observations[0]).toContain('skipped')
  })
})

describe('model-parser type mapping', () => {
  it('toSwiftType handles all primitives', async () => {
    const { toSwiftType } = await import('../../schema/generators/shared/model-parser.js')
    expect(toSwiftType({ name: 'x', type: 'String' })).toBe('String')
    expect(toSwiftType({ name: 'x', type: 'Int', optional: true })).toBe('Int?')
    expect(toSwiftType({ name: 'x', type: 'Bool' })).toBe('Bool')
    expect(toSwiftType({ name: 'x', type: 'String', isArray: true })).toBe('[String]')
    expect(toSwiftType({ name: 'x', type: 'String', isArray: true, optional: true })).toBe('[String]?')
  })

  it('toKotlinType handles Bool → Boolean mapping', async () => {
    const { toKotlinType } = await import('../../schema/generators/shared/model-parser.js')
    expect(toKotlinType({ name: 'x', type: 'Bool' })).toBe('Boolean')
    expect(toKotlinType({ name: 'x', type: 'Bool', optional: true })).toBe('Boolean?')
    expect(toKotlinType({ name: 'x', type: 'String', isArray: true })).toBe('List<String>')
  })

  it('toKotlinEnumCase converts camelCase to SCREAMING_SNAKE', async () => {
    const { toKotlinEnumCase } = await import('../../schema/generators/shared/model-parser.js')
    expect(toKotlinEnumCase('active')).toBe('ACTIVE')
    expect(toKotlinEnumCase('completed')).toBe('COMPLETED')
    expect(toKotlinEnumCase('inProgress')).toBe('IN_PROGRESS')
  })
})
