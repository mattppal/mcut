# Releases

mcut uses Changesets for package versioning and npm publishing.

## Creating a changeset

Run:

```sh
bunx changeset
```

Choose the packages affected by the change and the semver bump that matches the
public impact. Commit the generated file in `.changeset/` with the pull request.

## Publishing

Publishing runs from GitHub Actions on `main`.

When changesets are present, the release workflow opens a version pull request.
After that pull request is merged, the same workflow publishes changed packages
to npm.

Packages are configured for public access and npm provenance. npm trusted
publishing should be configured for `.github/workflows/release.yml` before the
first public release.
