/**
 * Brain — GitHub Issues
 * Creates/updates GitHub issues for Sentinel failures.
 * Uses the GitHub REST API. Deduplicates by title to avoid spam.
 * Requires config.github (owner, repo, token) or GITHUB_TOKEN env var.
 */
import type { ResolvedConfig, SentinelReport } from '../config/types.js'
import { log } from '../utils/logger.js'

const SENTINEL_LABEL = 'sentinel'
const SENTINEL_MARKER = '<!-- sentinel-issue -->'

interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  html_url: string
  body?: string
}

interface CreateIssuePayload {
  title: string
  body: string
  labels: string[]
}

export async function reportFailuresToGitHub(
  config: ResolvedConfig,
  report: SentinelReport
): Promise<void> {
  const githubConfig = config.github
  const token = githubConfig?.token ?? process.env.GITHUB_TOKEN

  if (!token) {
    log.dim('Brain/Issues: GITHUB_TOKEN not set — GitHub issue creation skipped')
    return
  }

  const owner = githubConfig?.owner
  const repo = githubConfig?.repo

  if (!owner || !repo) {
    log.dim('Brain/Issues: github.owner and github.repo not configured in sentinel.yaml')
    return
  }

  const errorIssues = report.results.flatMap(r =>
    r.issues.filter(i => i.severity === 'error')
  )

  if (errorIssues.length === 0) {
    log.success('Brain/Issues: No errors to report')
    return
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`
  const headers = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  // Ensure the sentinel label exists
  await ensureLabel(apiBase, headers)

  // Fetch existing open sentinel issues for deduplication
  const existingIssues = await fetchSentinelIssues(apiBase, headers)

  // Group errors by layer for one issue per layer
  const byLayer = new Map<string, typeof errorIssues>()
  for (const issue of errorIssues) {
    const key = issue.layer
    if (!byLayer.has(key)) byLayer.set(key, [])
    byLayer.get(key)!.push(issue)
  }

  for (const [layer, layerIssues] of byLayer.entries()) {
    const title = `[Sentinel] ${layer} failures in ${report.project} (${report.version})`
    const body = buildIssueBody(report, layer, layerIssues)

    const existing = existingIssues.find(i =>
      i.title.startsWith(`[Sentinel] ${layer} failures`)
    )

    if (existing) {
      // Update existing issue
      await updateIssue(apiBase, headers, existing.number, body)
      log.success(`Brain/Issues: Updated issue #${existing.number} for ${layer}`)
    } else {
      // Create new issue
      const issue = await createIssue(apiBase, headers, { title, body, labels: [SENTINEL_LABEL] })
      if (issue) {
        log.success(`Brain/Issues: Created issue #${issue.number} → ${issue.html_url}`)
      }
    }
  }

  // Close resolved issues (layers that were failing but now pass)
  for (const existing of existingIssues) {
    const layer = existing.title.match(/\[Sentinel\] (\S+) failures/)?.[1]
    if (layer && !byLayer.has(layer)) {
      await closeIssue(apiBase, headers, existing.number)
      log.success(`Brain/Issues: Closed resolved issue #${existing.number} (${layer} now passing)`)
    }
  }
}

function buildIssueBody(
  report: SentinelReport,
  layer: string,
  issues: Array<{ severity: string; layer: string; rule: string; message: string; fix?: string; file?: string }>
): string {
  const lines = [
    SENTINEL_MARKER,
    `## Sentinel CI Failure: \`${layer}\``,
    ``,
    `**Project:** ${report.project} v${report.version}`,
    `**Time:** ${report.timestamp}`,
    `**Run:** ${process.env.GITHUB_RUN_URL ?? 'local'}`,
    ``,
    `### Failures`,
    ``,
    ...issues.map(i => [
      `#### \`${i.rule}\``,
      `> ${i.message}`,
      i.file ? `**File:** \`${i.file}\`` : '',
      i.fix ? `**Fix:** ${i.fix}` : '',
      ``,
    ].filter(Boolean).join('\n')),
    `---`,
    `*This issue is managed by Sentinel CI. It will be updated on the next run and closed when resolved.*`,
  ]
  return lines.join('\n')
}

async function ensureLabel(apiBase: string, headers: Record<string, string>): Promise<void> {
  try {
    const res = await fetch(`${apiBase}/labels/${SENTINEL_LABEL}`, { headers })
    if (res.status === 404) {
      await fetch(`${apiBase}/labels`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: SENTINEL_LABEL,
          color: 'e11d48',
          description: 'Automated issue from Sentinel CI',
        }),
      })
    }
  } catch { /* non-fatal */ }
}

async function fetchSentinelIssues(apiBase: string, headers: Record<string, string>): Promise<GitHubIssue[]> {
  try {
    const res = await fetch(
      `${apiBase}/issues?labels=${SENTINEL_LABEL}&state=open&per_page=50`,
      { headers }
    )
    if (!res.ok) return []
    const issues = await res.json() as GitHubIssue[]
    return issues.filter(i => i.body?.includes(SENTINEL_MARKER))
  } catch {
    return []
  }
}

async function createIssue(
  apiBase: string,
  headers: Record<string, string>,
  payload: CreateIssuePayload
): Promise<GitHubIssue | null> {
  try {
    const res = await fetch(`${apiBase}/issues`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    return await res.json() as GitHubIssue
  } catch {
    return null
  }
}

async function updateIssue(
  apiBase: string,
  headers: Record<string, string>,
  issueNumber: number,
  body: string
): Promise<void> {
  try {
    await fetch(`${apiBase}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ body, state: 'open' }),
    })
  } catch { /* non-fatal */ }
}

async function closeIssue(
  apiBase: string,
  headers: Record<string, string>,
  issueNumber: number
): Promise<void> {
  try {
    await fetch(`${apiBase}/issues/${issueNumber}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ state: 'closed' }),
    })
  } catch { /* non-fatal */ }
}
