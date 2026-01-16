State management guidance:
- Pick the simplest viable option: server-state libs (React Query) for remote data; Context for app-scoped config; Zustand/Redux for shared client state.
- Model data flow: input -> state -> UI; avoid prop drilling via composition/context selectors.
- Keep derived state derived; avoid duplicating sources of truth.
- Side effects: isolate in hooks/stores; handle error/loading; cancel stale requests.
- Performance: use selectors to avoid re-renders; memoize expensive selectors; avoid storing non-serializable data unless scoped.
