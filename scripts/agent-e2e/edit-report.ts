import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckResult } from './edit-checks'
import type { Capability, FailureCause } from './edit-spec'
import type { StopReason, ToolCall } from './types'

export interface EditRow {
  id: string
  asked: string
  capability: Capability
  note: string
  driver: string
  toolCalls: ToolCall[]
  toolErrors: string[]
  toasts: string[]
  consoleErrors: string[]
  changes: string[]
  checks: CheckResult[]
  pass: boolean
  failure: FailureCause | null
  stoppedBy: StopReason
  finalMessage: string
  durationMs: number
  screenshot: string
  beforeFile: string
  afterFile: string
}

export interface EditReport {
  generatedAt: string
  driver: string
  app: string
  media: string[]
  rows: EditRow[]
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()

const list = (items: string[], empty: string): string => (items.length === 0 ? empty : items.map(cell).join('<br>'))

const callLine = (call: ToolCall): string => `${call.isError ? '✗' : '✓'} \`${call.name}\` ${cell(JSON.stringify(call.args)).slice(0, 140)}`

export function tally(rows: EditRow[]): Record<'pass' | FailureCause, number> {
  const counts = { pass: 0, 'agent-misuse': 0, 'tool-error': 0, 'missing-capability': 0 }
  for (const row of rows) counts[row.failure ?? 'pass'] += 1
  return counts
}

export function editMarkdown(report: EditReport): string {
  const counts = tally(report.rows)
  const header = [
    `Driver ${report.driver} against ${report.app}. ${counts.pass}/${report.rows.length} edits passed.`,
    `Failures by cause. agent misuse ${counts['agent-misuse']}, tool error ${counts['tool-error']}, missing capability ${counts['missing-capability']}.`,
    '',
    '| Edit | Verdict | Cause | Tool calls | Errors | Checks | What changed |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
  ]
  const rows = report.rows.map((row) =>
    [
      row.id,
      row.pass ? 'PASS' : 'FAIL',
      row.failure ?? '',
      String(row.toolCalls.length),
      String(row.toolErrors.length),
      list(row.checks.map((check) => `${check.pass ? '✓' : '✗'} ${check.check}. ${check.detail}`), ''),
      list(row.changes.slice(0, 4), 'nothing'),
    ].join(' | '),
  )
  const details = report.rows.flatMap((row) => [
    '',
    `### ${row.id}`,
    '',
    `Asked. ${row.asked}`,
    '',
    `Expected capability ${row.capability}${row.note.length > 0 ? `. ${row.note}` : ''}. Stopped by ${row.stoppedBy} after ${(row.durationMs / 1000).toFixed(1)} s.`,
    '',
    `Tool calls.<br>${list(row.toolCalls.map(callLine), 'none')}`,
    '',
    `Tool errors.<br>${list(row.toolErrors, 'none')}`,
    '',
    `Toasts.<br>${list(row.toasts, 'none')}`,
    '',
    `Console errors.<br>${list(row.consoleErrors.slice(0, 6), 'none')}`,
    '',
    `What changed.<br>${list(row.changes, 'nothing')}`,
    '',
    `Agent said. ${cell(row.finalMessage).slice(0, 600) || '(nothing)'}`,
    '',
    `![${row.id}](${row.screenshot})`,
  ])
  return [...header, ...rows.map((row) => `| ${row} |`), ...details, ''].join('\n')
}

export function writeEditReport(report: EditReport, dir: string): { json: string; markdown: string } {
  const json = join(dir, 'edit-report.json')
  const markdown = join(dir, 'edit-report.md')
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  writeFileSync(markdown, editMarkdown(report), 'utf8')
  return { json, markdown }
}
