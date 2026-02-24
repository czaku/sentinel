/**
 * Brain — Analyzer
 * Sends the full Sentinel report to Claude Haiku for intelligent root cause analysis.
 * Requires ANTHROPIC_API_KEY.
 */
import type { SentinelReport, ValidationIssue } from '../config/types.js'
import { log } from '../utils/logger.js'

export interface BrainAnalysis {
  summary: string
  rootCauses: string[]
  prioritisedActions: Array<{
    action: string
    priority: 'critical' | 'high' | 'medium' | 'low'
    layer: string
  }>
  patterns: string[]
}

export async function analyzeReport(report: SentinelReport): Promise<BrainAnalysis | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    log.dim('Brain: ANTHROPIC_API_KEY not set — AI analysis skipped')
    return null
  }

  if (report.passed) {
    log.success('Brain: All checks passed — no analysis needed')
    return null
  }

  const Anthropic = await import('@anthropic-ai/sdk').then(m => m.default).catch(() => null)
  if (!Anthropic) {
    log.warn('Brain: @anthropic-ai/sdk not installed — run: npm install @anthropic-ai/sdk')
    return null
  }

  log.dim('Brain: Analysing failures...')

  const allIssues: ValidationIssue[] = report.results.flatMap(r => r.issues)
  const errorIssues = allIssues.filter(i => i.severity === 'error')
  const warnIssues = allIssues.filter(i => i.severity === 'warning')

  const issuesSummary = [
    `Project: ${report.project} v${report.version}`,
    `Errors: ${report.summary.errors}, Warnings: ${report.summary.warnings}`,
    ``,
    `Errors:`,
    ...errorIssues.map(i => `  [${i.layer}/${i.rule}] ${i.message}${i.fix ? ` → ${i.fix}` : ''}`),
    ``,
    `Warnings:`,
    ...warnIssues.slice(0, 10).map(i => `  [${i.layer}/${i.rule}] ${i.message}`),
  ].join('\n')

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      system: `You are Sentinel Brain, a product integrity advisor.
Analyse CI failures and provide actionable guidance.
Return JSON only: {
  "summary": "1-2 sentence overview",
  "rootCauses": ["cause 1", ...],
  "prioritisedActions": [{"action": "...", "priority": "critical|high|medium|low", "layer": "..."}],
  "patterns": ["pattern 1", ...]
}`,
      messages: [{
        role: 'user',
        content: `Sentinel CI run failures:\n\n${issuesSummary}`,
      }],
    })

    const text = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    return JSON.parse(jsonMatch[0]) as BrainAnalysis
  } catch (err) {
    log.warn(`Brain analysis failed: ${String(err)}`)
    return null
  }
}
