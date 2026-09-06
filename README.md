# LastDone

[简体中文](README.zh-CN.md)

LastDone is a private, offline-first tracker for recurring things that are easy
to forget because they do not happen every day: replacing a filter, backing up
a computer, servicing a vehicle, renewing a document, and similar work.

It answers three questions:

1. When was this last completed?
2. When is it due again?
3. What is overdue or approaching its due date?

## Clients

- Installable iPhone Home Screen PWA from Safari
- Responsive desktop web application
- Signed Android APK built with Capacitor

All clients use the same self-hosted server and retain a usable local IndexedDB
copy after the first successful sign-in and synchronization. Android reminders
are scheduled locally and do not require Firebase or Google Play services.

## Highlights

- Completion-relative schedules in days, weeks, calendar months, or years
- Fixed monthly and yearly calendar schedules
- Overdue, today, due-soon, healthy, paused, and archived states
- One-tap completion, undo, history, past completion, and fixed-date skipping
- Categories, search, validated JSON backup/restore, and CSV export
- Offline outbox with automatic synchronization and interactive conflict resolution
- Web Push for iPhone PWA and desktop browsers
- Local notifications for Android, including quiet hours and a catch-up window
- Embedded PocketBase server with automatic migrations and backups
- Multi-platform Docker images and signed APK release workflows

## Quick Docker deployment

Copy [compose.yml](compose.yml) and create a `.env` beside it:

```dotenv
LASTDONE_IMAGE=getl/lastdone:latest
LASTDONE_PORT=8090
TZ=Asia/Shanghai
LASTDONE_VAPID_SUBJECT=https://lastdone.example.com
GOMEMLIMIT=384MiB
```

Then start the service:

```bash
docker compose up -d
```

The container binds only to `127.0.0.1:8090`. In 1Panel, create a website and
configure its reverse proxy to `http://127.0.0.1:8090`, then enable HTTPS for
the domain. No OpenResty configuration files are included or required by this
repository.

Create a PocketBase superuser, open `https://your-domain/_/`, and create the
single application user in the `users` collection. Public registration and
email delivery are disabled, so an SMTP server and port 25 are not required.

See [Docker and 1Panel deployment](docs/en/deployment.md) for the complete
procedure.

## Repository layout

```text
source/apps/web       React PWA and Capacitor Android application
source/packages/core Scheduling and status rules
source/packages/storage Offline database and repositories
source/packages/sync Client synchronization engine
source/server         Go application embedding PocketBase
docs/en               English operations documentation
docs/zh-CN            Simplified Chinese operations documentation
```

Product behavior is specified in [LASTDONE-DESIGN.en.md](LASTDONE-DESIGN.en.md).
Development commands are documented in [docs/en/development.md](docs/en/development.md).

## Security model

- There is no public account registration.
- Every synchronized record is scoped to its authenticated owner.
- The Docker container runs as UID/GID `10001`, drops Linux capabilities, and
  supports a read-only root filesystem.
- Android signing material is read only from local environment variables or
  GitHub Actions secrets and is excluded from Git.
- HTTPS is mandatory for the Android server address and strongly required for
  PWA installation and Web Push.

## License

No license has been selected yet. Until a license file is added, copyright is
reserved by the repository owner.
