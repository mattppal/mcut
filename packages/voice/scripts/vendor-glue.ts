import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const packageRoot = join(import.meta.dirname, '..')
const repoRoot = join(packageRoot, '..', '..')

const asyncInit = new Set(['__wbg_init', '__wbg_load', 'InitInput'])

const receiver = (expression: ts.Expression): string =>
  ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) ? expression.expression.text : ''

const isDropped = (node: ts.Node): boolean => {
  if (ts.isExportAssignment(node)) return true
  if (ts.isFunctionDeclaration(node) || ts.isTypeAliasDeclaration(node)) return asyncInit.has(node.name?.text ?? '')
  if (!ts.isExpressionStatement(node)) return false
  const { expression } = node
  if (ts.isCallExpression(expression)) return receiver(expression.expression) === 'console'
  return ts.isBinaryExpression(expression) && asyncInit.has(receiver(expression.left))
}

const isCommonJsRequire = (node: ts.Node): boolean => ts.isPropertyAccessExpression(node) && receiver(node) === 'module' && node.name.text === 'require'

const rewriteGlue: ts.TransformerFactory<ts.SourceFile> = (context) => (root) => {
  const visit = (node: ts.Node): ts.Node | undefined => {
    if (isDropped(node)) return undefined
    if (isCommonJsRequire(node)) return ts.factory.createIdentifier('undefined')
    if (ts.isIdentifier(node) && node.text === 'module') return ts.factory.createIdentifier('wasmModule')
    return ts.visitEachChild(node, visit, context)
  }
  return ts.visitEachChild(root, visit, context)
}

function vendor(from: string, name: string, kind: ts.ScriptKind): string {
  const source = ts.createSourceFile(name, readFileSync(join(from, name), 'utf8'), ts.ScriptTarget.Latest, true, kind)
  const [transformed] = ts.transform(source, [rewriteGlue]).transformed
  if (transformed === undefined) throw new Error(`could not transform ${name}`)
  const target = join(packageRoot, 'wasm', name)
  writeFileSync(target, ts.createPrinter({ removeComments: true }).printFile(transformed))
  return target
}

const [from] = process.argv.slice(2)
if (from === undefined) throw new Error('usage: bun scripts/vendor-glue.ts <wasm-pack out dir>')
const files = [vendor(from, 'df.js', ts.ScriptKind.JS), vendor(from, 'df.d.ts', ts.ScriptKind.TS)]
const format = Bun.spawnSync(['bunx', 'oxfmt', ...files], { cwd: repoRoot, stdout: 'inherit', stderr: 'inherit' })
if (format.exitCode !== 0) throw new Error('oxfmt failed on the vendored glue')
