import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { listFiles, repoRoot } from './measure'

const keptPrefixes = ['eslint-', '@ts-', 'prettier-ignore', 'biome-ignore', '#__PURE__']

interface Span {
  start: number
  end: number
}
type Deletion = Span & { kind: 'lines' | 'inline' }
interface StripResult {
  text: string
  removed: number
}

function isKept(comment: string): boolean {
  if (comment.includes('https://') || comment.startsWith('///')) return true
  const body = comment.startsWith('/*') ? comment.slice(2, -2) : comment.slice(2)
  const text = body.trimStart()
  return keptPrefixes.some((prefix) => text.startsWith(prefix))
}

const isJsDocNode = (node: ts.Node): boolean => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode

function commentOnlyContainer(next: ts.Node, comment: string, source: ts.SourceFile): Span | undefined {
  const parent = next.parent
  if (next.kind !== ts.SyntaxKind.CloseBraceToken || !ts.isJsxExpression(parent) || parent.expression) return undefined
  const start = parent.getStart(source)
  const inner = source.text.slice(start + 1, parent.getEnd() - 1).trim()
  return inner === comment ? { start, end: parent.getEnd() } : undefined
}

function findComments(text: string, fileName: string): Span[] {
  const tsx = fileName.endsWith('.tsx')
  const scriptKind = tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, scriptKind)
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, tsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard)
  const spans = new Map<number, Span>()
  let previousEnd = 0
  const collect = (from: number, to: number, next: ts.Node): void => {
    scanner.setText(text, from, to - from)
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      const isComment = kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia
      const comment = scanner.getTokenText()
      if (!isComment || isKept(comment)) continue
      const span = commentOnlyContainer(next, comment, source) ?? {
        start: scanner.getTokenStart(),
        end: scanner.getTokenEnd(),
      }
      spans.set(span.start, span)
    }
  }
  const visit = (node: ts.Node): void => {
    if (isJsDocNode(node)) return
    const children = node.getChildren(source)
    if (children.length > 0) {
      for (const child of children) visit(child)
      return
    }
    const start = node.getStart(source)
    if (start > previousEnd) collect(previousEnd, start, node)
    previousEnd = Math.max(previousEnd, node.getEnd())
  }
  visit(source)
  return [...spans.values()].sort((a, b) => a.start - b.start)
}

function expand(text: string, span: Span): Deletion {
  const lineStart = text.lastIndexOf('\n', span.start - 1) + 1
  const newline = text.indexOf('\n', span.end)
  const lineEnd = newline === -1 ? text.length : newline
  const prefix = text.slice(lineStart, span.start)
  const suffix = text.slice(span.end, lineEnd)
  if (prefix.trim() === '' && suffix.trim() === '') {
    return { kind: 'lines', start: lineStart, end: newline === -1 ? text.length : newline + 1 }
  }
  if (prefix.trim() === '') {
    return { kind: 'inline', start: span.start, end: span.end + suffix.length - suffix.trimStart().length }
  }
  return { kind: 'inline', start: span.start - (prefix.length - prefix.trimEnd().length), end: span.end }
}

function skipBlankLines(text: string, from: number): number {
  let position = from
  for (;;) {
    const newline = text.indexOf('\n', position)
    if (newline === -1) return position
    if (text.slice(position, newline).trim() !== '') return position
    position = newline + 1
  }
}

function applyDeletions(text: string, deletions: readonly Deletion[]): string {
  let output = ''
  let cursor = 0
  for (const deletion of deletions) {
    if (deletion.start < cursor) continue
    output += text.slice(cursor, deletion.start)
    cursor = deletion.end
    const atBlankBoundary = output === '' || output.endsWith('\n\n')
    if (deletion.kind === 'lines' && atBlankBoundary) cursor = skipBlankLines(text, cursor)
  }
  output += text.slice(cursor)
  return output.replace(/\n{2,}$/, '\n')
}

export function stripComments(text: string, fileName: string): StripResult {
  const spans = findComments(text, fileName)
  if (spans.length === 0) return { text, removed: 0 }
  const deletions = spans.map((span) => expand(text, span))
  return { text: applyDeletions(text, deletions), removed: spans.length }
}

function main(argv: readonly string[]): number {
  const check = argv.includes('--check')
  const paths = argv.filter((argument) => argument !== '--check')
  if (paths.length === 0) {
    console.error('usage: bun scripts/standards/strip-comments.ts [--check] <path...>')
    return 1
  }
  const relativePaths = paths.map((path) => relative(repoRoot, resolve(path)))
  const files = listFiles(repoRoot, relativePaths).filter((rel) => /\.tsx?$/.test(rel))
  let total = 0
  for (const rel of files) {
    const absolute = join(repoRoot, rel)
    const result = stripComments(readFileSync(absolute, 'utf8'), rel)
    if (result.removed === 0) continue
    total += result.removed
    console.log(`${rel} ${result.removed}`)
    if (!check) writeFileSync(absolute, result.text)
  }
  console.log(check ? `${total} comments would be deleted` : `${total} comments deleted`)
  return 0
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2))
}
