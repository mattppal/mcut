import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { jsonObjectSchema } from './json'
import type { FailureCause } from './edit-spec'
import type { ToolCall } from './types'

const toolCallSchema = z.object({ name: z.string(), args: jsonObjectSchema, result: z.string(), isError: z.boolean(), durationMs: z.number() })

const editRowSchema = z.object({
  id: z.string(),
  asked: z.string(),
  capability: z.enum(['exists', 'partial', 'missing']),
  note: z.string(),
  driver: z.string(),
  toolCalls: z.array(toolCallSchema),
  toolErrors: z.array(z.string()),
  toasts: z.array(z.string()),
  consoleErrors: z.array(z.string()),
  changes: z.array(z.string()),
  checks: z.array(z.object({ check: z.string(), pass: z.boolean(), detail: z.string() })),
  pass: z.boolean(),
  failure: z.enum(['agent-misuse', 'tool-error', 'missing-capability']).nullable(),
  stoppedBy: z.enum(['model', 'step-cap', 'wall-clock', 'error']),
  finalMessage: z.string(),
  durationMs: z.number(),
  screenshot: z.string(),
  beforeFile: z.string(),
  afterFile: z.string(),
})

const editReportSchema = z.object({ generatedAt: z.string(), driver: z.string(), app: z.string(), media: z.array(z.string()), rows: z.array(editRowSchema) })

export type EditRow = z.infer<typeof editRowSchema>

export type EditReport = z.infer<typeof editReportSchema>

export const readEditReport = (dir: string): EditReport => editReportSchema.parse(JSON.parse(readFileSync(join(dir, 'edit-report.json'), 'utf8')))

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
