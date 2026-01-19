Routing guidance:
- Define route map upfront; use nested routes for layout reuse; prefer lazy loading per route chunk.
- Guards: centralize auth/role checks; redirect vs render fallback; avoid guard logic scattered in components.
- UX: preserve scroll and focus; handle 404/403; show transitions for slow routes.
- Code splitting: split by route boundaries; prefetch likely next routes; avoid excessive micro-chunks.
