import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { repoRoot } from './fixtures'
import type { TaskRun } from './types'

export interface Report {
  generatedAt: string
  model: string
  target: string
  dryRun: boolean
  passed: number
  failed: number
  runs: TaskRun[]
}

export const REPORTS_DIR = 'reports/agent-e2e'

export function buildReport(runs: TaskRun[], model: string, target: string, dryRun: boolean): Report {
  const passed = runs.filter((run) => run.verdict.pass).length
  return {
    generatedAt: new Date().toISOString(),
    model,
    target,
    dryRun,
    passed,
    failed: runs.length - passed,
    runs,
  }
}

export function createRunDir(label: string, baseDir = join(repoRoot, REPORTS_DIR)): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = join(baseDir, `${stamp}-${label}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeReport(report: Report, dir: string): string {
  const file = join(dir, 'report.json')
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return file
}

const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ')

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

function reasons(run: TaskRun): string {
  if (run.verdict.pass) return run.finalMessage.length > 0 ? run.finalMessage : 'all checks passed'
  return run.verdict.reasons.join('; ')
}

export function markdownTable(report: Report): string {
  const header = '| Task | Verdict | Steps | Tool calls | Errors | Duration | Tokens in/out | Notes |'
  const divider = '| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |'
  const rows = report.runs.map((run) => {
    const errors = run.toolCalls.filter((call) => call.isError).length
    return [
      run.task.id,
      run.verdict.pass ? 'PASS' : 'FAIL',
      String(run.steps),
      String(run.toolCalls.length),
      String(errors),
      seconds(run.durationMs),
      `${run.tokens.input}/${run.tokens.output}`,
      cell(reasons(run)),
    ].join(' | ')
  })
  const summary =
    `${report.passed}/${report.runs.length} tasks passed with model ${report.model} ` +
    `against ${report.target}${report.dryRun ? ' (dry run)' : ''}.`
  return [header, divider, ...rows.map((row) => `| ${row} |`), '', summary].join('\n')
}
