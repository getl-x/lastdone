# LastDone source

This directory contains all application source code for LastDone.

- `apps/web` — responsive PWA and shared Capacitor web bundle
- `packages/core` — recurring schedule and status domain
- `packages/storage` — offline IndexedDB database and repositories
- `packages/sync` — client synchronization engine
- `packages/contracts` — cross-language schedule contract fixtures
- `server` — custom Go application embedding PocketBase

Use Node.js 22.12 or newer.

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
```
