Key practices:
- Project hygiene: strict TypeScript, eslint+prettier, path aliases, env typing, absolute imports.
- Components: small, focused; prefer composition; use memo only for hot paths; stable keys; avoid inline heavy lambdas.
- Hooks: custom hooks for data/logic reuse; handle cleanup; guard against stale closures.
- UI states: explicit loading/error/empty/success branches; skeletons for async UI.
- Data fetching: centralize API clients; handle retries/timeouts; type responses; normalize data when helpful.
- Testing: component tests for critical UI/logic; mock network; cover edge states.
