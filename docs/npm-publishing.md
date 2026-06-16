# npm publishing

This repository publishes the public SDK packages from `packages/*`.
npmjs is the canonical public registry. GitHub Packages is maintained as a
repository-visible mirror; see [GitHub Packages](github-packages.md).

## Package names

Publish these packages in the first alpha batch:

- `@mcut/timeline`
- `@mcut/editor`
- `@mcut/compositor`
- `@mcut/media`
- `@mcut/react`
- `@mcut/transcription`
- `@mcut/transcription-ai-sdk`
- `@mcut/transcription-assemblyai`
- `@mcut/transcription-local`
- `@mcut/cli`
- `@mcut/mcp-server`

The packages require the `mcut` npm organization or user scope. npm does not
provide a separate generic namespace reservation flow; controlling the scope and
publishing the first real public packages is the reservation step. The unscoped
`mcut` package name is blocked by npm's automated name-similarity protections,
so the CLI is published and documented as `@mcut/cli`.

## One-time npm setup

1. Create or claim the `mcut` npm organization/user scope.
2. Make sure the publishing account has 2FA enabled.
3. Publish the first alpha batch from GitHub Actions.
4. In npm package settings, configure trusted publishing for each package using
   this repository and `.github/workflows/release.yml`.
5. Keep long-lived npm automation tokens out of GitHub secrets. The release
   workflow uses GitHub OIDC plus npm provenance.

## GitHub Packages mirror

The release workflow mirrors successfully published npmjs versions to
GitHub Packages. This is a separate registry, not a link to npmjs. Keep the same
package names and versions in both registries.

The `@mcut/*` GitHub Packages mirror should run from a repository owned by the
`mcut` GitHub account or organization, because GitHub Packages routes scoped npm
packages by GitHub namespace.

If npm requires a package to exist before trusted publishing can be configured,
do the first publish manually with:

```sh
bun install --frozen-lockfile
bun run release:check
npm publish packages/<name> --access public --provenance --tag alpha
```

Then configure trusted publishing before the next release.

## Release commands

For PRs that change public package behavior:

```sh
bun run changeset
```

Before merging a release PR:

```sh
bun run release:check
```

The release workflow runs the same check, then `changeset publish --tag alpha`
with `NPM_CONFIG_PROVENANCE=true`.

## Dist-tags

- Use `alpha` while APIs are still moving.
- Move to `latest` only after the SDK has stable install docs and compatibility
  expectations for Node, Bun, browser bundlers, React, WebCodecs, and MCP.
- Use `npm dist-tag add <package>@<version> latest` deliberately; do not make
  the first public alpha the default install path.

## Rollback and cleanup

npm package versions are immutable. For a bad alpha:

1. Publish a fixed patch alpha.
2. Deprecate the bad version:

   ```sh
   npm deprecate <package>@<version> "Use <fixed-version> instead."
   ```

3. Move dist-tags away from the bad version if needed.

Unpublish only within npm's allowed window and only for accidental or sensitive
publishes. Prefer deprecation for normal release mistakes.
