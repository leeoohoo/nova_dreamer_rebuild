# Releasing (SemVer + npm)

This repo is an npm workspaces monorepo. Packages are released independently.

## Versioning

- Follow SemVer: `MAJOR.MINOR.PATCH`
- Bump the workspace `package.json` version before publishing.

## Tagging

Use package-scoped tags:

- `aide-vX.Y.Z` → `aide/` (`@leeoohoo/aide`)
- `chatos-vX.Y.Z` → `chatos/` (`@leeoohoo/chatos`)
- `common-vX.Y.Z` → `common/` (`@leeoohoo/common`)
- `ui-apps-devkit-vX.Y.Z` → `chatos-uiapps-devkit/` (`@leeoohoo/ui-apps-devkit`)

## Publish to npm

1. Ensure you are logged in (`npm login`) and have publish rights for the scope.
2. From repo root:

```bash
npm ci
npm publish -w <workspace> --access public
```

## GitHub Actions (recommended)

If `NPM_TOKEN` is set in repo secrets, pushing a tag listed above will publish the
corresponding workspace via `.github/workflows/release.yml`.
