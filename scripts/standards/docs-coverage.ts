import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const defaultPackagesRoot = join(repoRoot, 'packages')
const defaultDocsRoot = join(repoRoot, 'apps', 'web', 'content', 'docs', 'sdk')

export interface StaleHeading {
  heading: string
  page: string
}

export interface PackageCoverage {
  name: string
  exports: string[]
  pages: string[]
  missing: string[]
  stale: StaleHeading[]
}

const isFile = (path: string): boolean => existsSync(path) && statSync(path).isFile()
const isDirectory = (path: string): boolean => existsSync(path) && statSync(path).isDirectory()

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function resolveModule(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier.replace(/\.js$/, ''))
  return [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), base].find(isFile)
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => (ts.isBindingElement(element) ? bindingNames(element.name) : []))
}

function isExported(statement: ts.Statement): boolean {
  if (!ts.canHaveModifiers(statement)) return false
  return (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

function declaredNames(statement: ts.Statement): string[] {
  if (!isExported(statement)) return []
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) => bindingNames(declaration.name))
  }
  const named =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isEnumDeclaration(statement)
  if (!named) return []
  return statement.name === undefined ? [] : [statement.name.text]
}

function reexportedNames(statement: ts.ExportDeclaration, depth: number): string[] {
  const clause = statement.exportClause
  if (clause !== undefined) {
    return ts.isNamedExports(clause) ? clause.elements.map((element) => element.name.text) : [clause.name.text]
  }
  const specifier = statement.moduleSpecifier
  if (depth > 0 || specifier === undefined || !ts.isStringLiteral(specifier)) return []
  const target = resolveModule(statement.getSourceFile().fileName, specifier.text)
  return target === undefined ? [] : collectExports(target, depth + 1)
}

function collectExports(path: string, depth: number): string[] {
  return parse(path).statements.flatMap((statement) => (ts.isExportDeclaration(statement) ? reexportedNames(statement, depth) : declaredNames(statement)))
}

export function listExports(indexPath: string): string[] {
  return [...new Set(collectExports(indexPath, 0))].sort()
}

export function listHeadings(pageText: string): string[] {
  const headings: string[] = []
  let fenced = false
  for (const raw of pageText.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const match = /^###\s+(.+?)\s*$/.exec(line)
    if (match?.[1] !== undefined) headings.push(match[1].replace(/^`(.+)`$/, '$1'))
  }
  return headings
}

function listPages(docsRoot: string, name: string): string[] {
  const pages: string[] = []
  const single = join(docsRoot, `${name}.mdx`)
  const folder = join(docsRoot, name)
  if (isFile(single)) pages.push(single)
  if (isDirectory(folder)) {
    for (const entry of readdirSync(folder)) {
      if (entry.endsWith('.mdx')) pages.push(join(folder, entry))
    }
  }
  return pages.sort()
}

export function coverPackage(name: string, indexPath: string, pages: readonly string[], docsRoot: string): PackageCoverage {
  const exports = listExports(indexPath)
  const exported = new Set(exports)
  const documented = new Set<string>()
  const stale: StaleHeading[] = []
  for (const page of pages) {
    const pageName = relative(docsRoot, page)
    for (const heading of listHeadings(readFileSync(page, 'utf8'))) {
      if (exported.has(heading)) documented.add(heading)
      else stale.push({ heading, page: pageName })
    }
  }
  return {
    name,
    exports,
    pages: pages.map((page) => relative(docsRoot, page)),
    missing: exports.filter((entry) => !documented.has(entry)),
    stale,
  }
}

export function coverPackages(packagesRoot: string, docsRoot: string): PackageCoverage[] {
  const coverage: PackageCoverage[] = []
  for (const name of readdirSync(packagesRoot).sort()) {
    const indexPath = join(packagesRoot, name, 'src', 'index.ts')
    const pages = listPages(docsRoot, name)
    if (!isFile(indexPath) || pages.length === 0) continue
    coverage.push(coverPackage(name, indexPath, pages, docsRoot))
  }
  return coverage
}

export function formatFindings(coverage: readonly PackageCoverage[]): string[] {
  return coverage.flatMap((entry) => [
    ...entry.missing.map((name) => `${entry.name}: export ${name} has no heading`),
    ...entry.stale.map((stale) => `${entry.name}: heading ${stale.heading} in ${stale.page} names no export`),
  ])
}

function formatSummary(coverage: readonly PackageCoverage[]): string[] {
  const total = coverage.reduce((sum, entry) => sum + entry.exports.length, 0)
  return [
    ...coverage.map((entry) => `${entry.name} ${entry.exports.length} exports on ${entry.pages.length} pages`),
    `${coverage.length} packages, ${total} exports documented`,
  ]
}

function main(argv: readonly string[]): number {
  const coverage = coverPackages(defaultPackagesRoot, defaultDocsRoot)
  const findings = formatFindings(coverage)
  if (argv.includes('--json')) {
    console.log(JSON.stringify(coverage, null, 2))
    return findings.length === 0 ? 0 : 1
  }
  if (findings.length === 0) {
    for (const line of formatSummary(coverage)) console.log(line)
    return 0
  }
  for (const line of findings) console.log(line)
  return 1
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2))
}
