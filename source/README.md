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

The Android project is located at `apps/web/android`. Its shared web bundle is created
without a PWA service worker and copied with:

```bash
npm run android:sync --workspace @lastdone/web
```

Do not commit copied Android web assets, Gradle output, PocketBase runtime data,
environment files, or signing keys. See the bilingual documentation in the
repository-level `docs` directory for deployment and release procedures.
