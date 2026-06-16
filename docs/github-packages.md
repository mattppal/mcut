# GitHub Packages

mcut publishes public packages to npmjs and mirrors the same package versions to
GitHub Packages.

## Registry roles

- npmjs is the canonical public install registry.
- GitHub Packages is a repository-visible mirror for GitHub's Packages UI.
- GitHub Releases are created from Changesets and provide the human-readable
  release history.

Do not replace npmjs with GitHub Packages for the public SDK. GitHub Packages is
a separate npm registry and consumers must configure `npm.pkg.github.com` before
installing from it.

## Namespace requirement

GitHub Packages stores npm packages under the GitHub user or organization that
matches the package scope. The `@mcut/*` packages should therefore be published
from a repository owned by the `mcut` GitHub account or organization.

Recommended setup:

1. Create or claim the `mcut` GitHub organization.
2. Transfer this repository to `mcut/mcut`.
3. Keep the npmjs `mcut` organization as the canonical package owner.
4. Keep package names as `@mcut/*` in both registries.

Publishing `@mcut/*` GitHub Packages from `mattppal/mcut` is not the target
state. It may require a personal access token or package-level permissions, and
it leaves the public package namespace split across owners.

## Release workflow

`.github/workflows/release.yml` publishes to npmjs through Changesets first.
When `changesets/action` reports that packages were published, the workflow then
runs:

```sh
bun run release:github-packages
```

That script reads `PUBLISHED_PACKAGES` from the Changesets action output and
publishes only those package versions to `https://npm.pkg.github.com`.

The workflow uses:

- `NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` for npmjs publishing.
- `GITHUB_PACKAGES_TOKEN: ${{ github.token }}` for GitHub Packages.
- `permissions.packages: write` so the generated workflow token can publish
  packages associated with the repository.

The mirror script is idempotent. If a package version already exists in GitHub
Packages, it skips that version.

## First mirror or backfill

After the repository lives under the `mcut` GitHub owner, backfill the current
manifest versions with:

```sh
GITHUB_PACKAGES_TOKEN=<token> bun run release:github-packages -- --all
```

Use a classic GitHub personal access token with package publishing permission if
running locally. In GitHub Actions, use the generated workflow token.

For a dry run:

```sh
bun run release:github-packages -- --all --dry-run
```

## Package visibility and linking

Each package's `repository` field points at this repository and includes its
package directory. GitHub uses that metadata to connect multiple packages to the
same repository.

After the first GitHub Packages publish:

1. Open the GitHub organization or user profile.
2. Go to **Packages**.
3. Open each `@mcut/*` package.
4. Confirm it is connected to `mcut/mcut`.
5. Confirm package visibility is public or inherits from the public repository.

If a package is not linked automatically, connect it from the package settings.
