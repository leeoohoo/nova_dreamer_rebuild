# Contributing

Thanks for taking the time to contribute!

This repo is an npm workspaces monorepo:

- `chatos/`: ChatOS host (Electron desktop)
- `chatos/aide/`: AIDE engine (tools/MCP/subagents)
- `chatos/common/`: shared runtime utilities/components
- `chatos-uiapps-devkit/`: UI Apps DevKit (CLI + templates)

## Prerequisites

- Node.js `>=18`
- npm `>=9`

## Local setup

```bash
npm ci
npm test
```

## Useful commands

Run a workspace script:

```bash
npm -w chatos/aide test
npm -w chatos start
```

Build ChatOS UI (if needed):

```bash
npm -w chatos build
```

## Pull requests

- Keep changes focused and small.
- Add/update tests when behavior changes.
- Ensure `npm test` passes.
- Fill out the PR template and link related issues.

## Reporting issues / requesting features

Please use the GitHub Issue templates and include:

- expected vs actual behavior
- repro steps (minimal repo/config if possible)
- logs/screenshots and environment (OS, Node version)
