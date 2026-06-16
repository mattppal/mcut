# Maintainer Guide

This guide covers the repository settings that cannot be fully enforced from
files alone.

## GitHub access

- Keep the owner account as the only admin until there are trusted maintainers.
- Give future maintainers access through a GitHub organization team, not as a
  loose list of individual collaborators.
- Prefer `Triage` for issue helpers and `Write` or `Maintain` only for people
  who should approve and merge code.

## Branch protection

Protect `main` with a ruleset or branch protection rule:

- Require pull requests before merging.
- Require at least one approving review.
- Require review from code owners.
- Dismiss stale approvals when new commits are pushed.
- Require the CI workflow to pass.
- Block force pushes and branch deletion.
- Restrict bypass permissions to the owner and, later, the maintainers team.

The repository `CODEOWNERS` file currently makes `@mattppal` the owner for all
paths. If the project moves into an organization, replace that with a
maintainers team such as `@mcut/maintainers`.

## npm publishing

Use npm trusted publishing for the `Release` GitHub Actions workflow:

- Create or control the `mcut` npm organization.
- Add each `@mcut/*` package to npm.
- Configure each package's trusted publisher to this repository and
  `.github/workflows/release.yml`.
- Keep package provenance enabled.
- Avoid long-lived npm automation tokens unless trusted publishing is blocked.

If a token fallback is needed, create an npm automation token with the narrowest
scope available and save it as the repository secret `NPM_TOKEN`.

## GitHub Packages

Mirror npmjs releases to GitHub Packages so the packages appear on the GitHub
repository homepage:

- Prefer hosting the repository under the `mcut` GitHub organization so the
  `@mcut/*` package scope and GitHub owner match.
- Keep npmjs as the canonical public package registry.
- Use GitHub Packages only as the GitHub-visible mirror.
- Confirm each package is linked to the repository and public after the first
  mirror publish.

The release workflow uses the generated workflow token for the mirror. For local
backfills, use a classic GitHub personal access token with package publishing
permission:

```sh
GITHUB_PACKAGES_TOKEN=<token> bun run release:github-packages -- --all
```

## Release process

1. Include a changeset in any pull request that changes public package behavior.
2. Merge pull requests into `main` after CI and code-owner review pass.
3. The release workflow opens a version pull request when changesets are present.
4. Review and merge the version pull request.
5. The release workflow publishes changed packages to npm and creates GitHub
   release notes through Changesets.
6. The release workflow mirrors those package versions to GitHub Packages.

## Repository settings checklist

- Enable private vulnerability reporting.
- Enable Dependabot alerts and Dependabot security updates.
- Enable secret scanning and push protection if available for the repository.
- Disable merge methods the project will not use.
- Require signed commits only if maintainers can support it consistently.
