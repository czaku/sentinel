/**
 * Visual — AI Parity
 * Sends screenshot pairs (apple vs google, or web vs mobile) to Claude
 * for high-level visual parity assessment.
 * Requires ANTHROPIC_API_KEY.
 */
import fs from 'fs'
import path from 'path'
import type { ResolvedConfig, ValidationResult, ValidationIssue } from '../config/types.js'
import { log } from '../utils/logger.js'

interface ParityPair {
  name: string
  platformA: string
  platformB: string
  pathA: string
  pathB: string
}

interface ParityAssessment {
  name: string
  parityScore: number  // 0–10
  issues: string[]
  summary: string
}

export async function checkVisualParity(
  config: ResolvedConfig,
  platformA: string,
  platformB: string
): Promise<ValidationResult> {
  const start = performance.now()
  const issues: ValidationIssue[] = []
  const baselines = path.join(config.sentinelDir, 'visual', 'baselines')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      layer: 'visual.parity',
      passed: true,
      issues: [{
        severity: 'info',
        layer: 'visual.parity',
        rule: 'no-api-key',
        message: 'ANTHROPIC_API_KEY not set — AI visual parity check skipped',
        fix: 'Set ANTHROPIC_API_KEY to enable AI-powered visual parity analysis',
      }],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  const dirA = path.join(baselines, platformA)
  const dirB = path.join(baselines, platformB)

  if (!fs.existsSync(dirA) || !fs.existsSync(dirB)) {
    return {
      layer: 'visual.parity',
      passed: true,
      issues: [{
        severity: 'info',
        layer: 'visual.parity',
        rule: 'no-baselines',
        message: `No baselines for ${platformA} and/or ${platformB} — run visual:capture first`,
      }],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  // Find matching screenshot names in both platforms
  const namesA = new Set(
    fs.readdirSync(dirA).filter(f => f.endsWith('.png')).map(f => f.replace(/\.png$/, ''))
  )
  const namesB = new Set(
    fs.readdirSync(dirB).filter(f => f.endsWith('.png')).map(f => f.replace(/\.png$/, ''))
  )
  const commonNames = [...namesA].filter(n => namesB.has(n))

  if (commonNames.length === 0) {
    return {
      layer: 'visual.parity',
      passed: true,
      issues: [{
        severity: 'info',
        layer: 'visual.parity',
        rule: 'no-pairs',
        message: `No matching screenshot names found between ${platformA} and ${platformB}`,
      }],
      durationMs: Math.round(performance.now() - start),
      checkedCount: 0,
    }
  }

  const pairs: ParityPair[] = commonNames.map(name => ({
    name,
    platformA,
    platformB,
    pathA: path.join(dirA, `${name}.png`),
    pathB: path.join(dirB, `${name}.png`),
  }))

  log.header(`AI Visual Parity: ${platformA} ↔ ${platformB} (${pairs.length} screens)`)
  log.rule()

  const assessments = await assessParityWithAI(pairs, apiKey, config.project)
  let failedCount = 0

  for (const assessment of assessments) {
    const score = assessment.parityScore
    const label = `${assessment.name}: score ${score}/10`
    if (score >= 7) {
      log.success(label)
    } else if (score >= 4) {
      log.warn(label + ` — ${assessment.summary}`)
    } else {
      log.error(label + ` — ${assessment.summary}`)
      failedCount++
      for (const issue of assessment.issues) {
        console.log(`    • ${issue}`)
      }
      issues.push({
        severity: 'error',
        layer: 'visual.parity',
        rule: 'low-parity-score',
        message: `${assessment.name} parity score ${score}/10 (${assessment.summary})`,
        fix: `Review ${platformA} and ${platformB} implementations for ${assessment.name}`,
      })
    }
  }

  return {
    layer: 'visual.parity',
    passed: failedCount === 0,
    issues,
    durationMs: Math.round(performance.now() - start),
    checkedCount: pairs.length,
  }
}

async function assessParityWithAI(
  pairs: ParityPair[],
  apiKey: string,
  projectName: string
): Promise<ParityAssessment[]> {
  const Anthropic = await import('@anthropic-ai/sdk').then(m => m.default).catch(() => null)
  if (!Anthropic) {
    return pairs.map(p => ({
      name: p.name,
      parityScore: 5,
      issues: [],
      summary: '@anthropic-ai/sdk not installed — install to enable AI parity checks',
    }))
  }

  const client = new Anthropic({ apiKey })
  const assessments: ParityAssessment[] = []

  for (const pair of pairs) {
    try {
      const imgA = fs.readFileSync(pair.pathA).toString('base64')
      const imgB = fs.readFileSync(pair.pathB).toString('base64')

      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `You are a UI parity reviewer for ${projectName}.
Compare two screenshots of the same screen on different platforms (${pair.platformA} and ${pair.platformB}).
Return JSON: { "parityScore": <0-10>, "issues": ["...", ...], "summary": "..." }
parityScore: 10=identical UX, 7+=acceptable parity, 4-6=notable differences, <4=significant parity failure.
Focus on: layout, information hierarchy, interactive elements, colours, typography.`,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Screen: "${pair.name}"\nPlatform A (${pair.platformA}):` },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imgA } },
            { type: 'text', text: `Platform B (${pair.platformB}):` },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imgB } },
          ],
        }],
      })

      const text = response.content[0].type === 'text' ? response.content[0].text : ''
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Omit<ParityAssessment, 'name'>
        assessments.push({ name: pair.name, ...parsed })
      } else {
        assessments.push({ name: pair.name, parityScore: 5, issues: [], summary: 'Could not parse AI response' })
      }
    } catch (err) {
      assessments.push({ name: pair.name, parityScore: 5, issues: [], summary: `AI error: ${String(err)}` })
    }
  }

  return assessments
}
