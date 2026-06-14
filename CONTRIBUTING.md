# Contributing to mcut

Thanks for helping! A few ground rules keep the project healthy:

## Clean-room policy

mcut mirrors the package boundaries and concepts of prior art (notably Twick, which is
Sustainable-Use licensed) **without copying any code, identifiers, or documentation**. Do not
port, paraphrase, or "reference-implement" from license-incompatible codebases. If you've read
such code recently, describe the behavior you want in an issue instead of writing the patch.

## Development

```sh
bun install
bun run build && bun test && bun run typecheck
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
