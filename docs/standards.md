# Coding standards check

`scripts/standards/measure.ts` measures coding-standard drift with line regexes. `release:check` runs it, so CI fails when a pull request grows a tracked metric. `scripts/standards/strip-comments.ts` deletes comments with the TypeScript scanner.

## Commands

```sh
bun run standards
bun scripts/standards/measure.ts --json out.json
bun run standards:strip --check packages/timeline/src
bun run standards:strip packages/timeline/src
```

`bun run standards` prints the markdown report for HEAD, then compares HEAD with the merge base of HEAD and `origin/main`. It exports that merge base with `git worktree add --detach` into a temp directory and removes it afterwards. When `origin/main` is missing locally, run `git fetch origin main` first.

## What is measured

Areas are `packages`, `apps/studio`, `apps/web`, and `skills+scripts+examples`. Each file lands in one bucket. `tests` holds paths matching `.test.ts`, `.spec.ts`, or `/e2e/`. `prose` holds `.md` and `.mdx`. Everything else is `code`. The walk skips `node_modules`, `dist`, `.next`, `out`, `public`, `reference`, `components/ui/`, `components/kibo-ui/`, and `content/docs/sdk/reference/`. Files come from `git ls-files`, so ignored build output never counts.

Metric ids are `loc`, `commentLines`, `jsdocLines`, `useEffect`, `useRefState`, `useStateBool`, `asCast`, `asUnknownAs`, `anyType`, `nonNull`, `tsSuppress`, `eslintDisable`, `recordUnknown`, `consoleLog`, `todo`, `elseIf`, `switchStmt`, `longFile`, `longDash`, `colonConnector`, `optionalProps`, and `emptyCatch`. The report lists each definition next to its top offender files.

Directive comments (`eslint-`, `@ts-`, `prettier-ignore`) and shebangs are not comment lines. A `//` inside a string or an `https://` URL is not a comment. `consoleLog` skips `scripts/`, `tools/`, and the `tests` bucket.

## Growth rule

Every metric except `loc` is gated. The check fails with exit 1 when any gated metric in any area and bucket is higher at HEAD than at the merge base. Each failure prints one line in the form `growth area/bucket metric base -> head` followed by the files that grew. A clean run prints `no growth`.

## Bans

Banned metrics fail on any nonzero count at HEAD, whatever the base held. The list is the `bans` constant in `measure.ts`. Today it holds `anyType`, `tsSuppress`, and `todo`, all in the `code` bucket. A ban prints `ban area/bucket metric count` followed by the offending files.

To promote a metric, add one entry to `bans`, for example `{ metric: 'commentLines', bucket: 'code' }`. The count at HEAD must already be zero, so strip or fix the offenders in the same pull request.

## Stripping comments

`strip-comments.ts` walks `.ts` and `.tsx` files under the given paths with the same skips and deletes every comment except a shebang, a comment containing `https://`, a triple-slash reference, and directives starting with `eslint-`, `@ts-`, `prettier-ignore`, `biome-ignore`, or `#__PURE__`. A comment that was alone on its line takes the line with it, and blank-line runs created by the deletion collapse to one. `--check` prints per-file counts and writes nothing. Running it twice deletes nothing the second time.
