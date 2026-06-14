# Contributing to mcut

Thanks for helping! A few ground rules keep the project healthy:

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Clean-room policy

mcut mirrors the package boundaries and concepts of prior art (notably Twick, which is
Sustainable-Use licensed) **without copying any code, identifiers, or documentation**. Do not
port, paraphrase, or "reference-implement" from license-incompatible codebases. If you've read
such code recently, describe the behavior you want in an issue instead of writing the patch.

## Development

```sh
bun install
bun run build
bun run typecheck
bun run test
bun run smoke:packages
```

- Engine invariants (no track overlaps, integer-ms timing) are enforced in `@mcut/timeline`
  command reducers — add tests beside any reducer change (`*.test.ts`, `bun test`).
- `@tanstack/store` is alpha: import it only inside `@mcut/timeline`; everything else goes
  through the `EditorEngine` facade.
- Keep package boundaries clean: reusable edit behavior belongs in `@mcut/timeline`
  or `@mcut/editor`; React bindings belong in `@mcut/react`; product UI belongs in
  downstream apps.

## Releases

Versioning uses [Changesets](https://github.com/changesets/changesets): run `bunx changeset`
with your PR when a package's public API changes.

The release workflow opens a version pull request from merged changesets and
publishes changed packages after that version pull request is merged. See
[docs/RELEASES.md](docs/RELEASES.md).

## Pull requests

- Keep changes scoped to one behavior or package boundary when possible.
- Add or update tests beside behavior changes.
- Update README or package docs when public usage changes.
- Include validation commands in the pull request description.
- Do not include generated `dist/` output.
