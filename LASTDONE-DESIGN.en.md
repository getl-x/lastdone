# LastDone Product and Technical Design

Date: 2026-09-05  
Status: Approved in conversation; awaiting written-spec review  
Working product name: LastDone

## 1. Purpose

LastDone is a personal, self-hosted application for recurring activities that
do not belong in a daily task list but must be repeated periodically.

Examples include replacing a water filter, backing up a computer, cleaning an
air conditioner filter, visiting a dentist, servicing a vehicle, and checking
household equipment.

The product answers three questions:

1. When was this last completed?
2. When should it be completed again?
3. What is overdue or approaching its due date?

LastDone is not a general task manager, habit tracker, journal, calendar, or
gamification system. Version 1 will not include streaks, points, daily check-ins,
free-form notes, attachments, shared lists, or public registration.

## 2. Product Priorities

The supported clients are implemented in this order:

1. An installable iPhone Home Screen web application opened from Safari.
2. A responsive application usable directly in desktop browsers.
3. A signed Android APK for sideloading on a Redmi K80 Ultra.

All clients share the same account and synchronized data. Every client remains
usable offline after its first successful sign-in and synchronization.

Version 1 is single-user. The data model includes ownership boundaries from the
beginning so that a later version can add family accounts and selectively
shared items without rebuilding the storage layer.

## 3. User Experience

### 3.1 Dashboard

The dashboard is the default screen. It groups items in this order:

1. Overdue
2. Due today
3. Due soon
4. Healthy
5. Not started

Within each group, items with the nearest due date appear first. The dashboard
shows counts for overdue, due-today, and due-soon items.

Each item card shows:

- category icon and color;
- item name;
- relative status, such as "12 days overdue" or "7 days remaining";
- last completion date when available;
- a one-tap Complete action;
- an overflow menu for less common actions.

The dashboard supports text search and filtering by one category. Search covers
item names and completion notes.

The default "due soon" window is seven days and is configurable in settings.

### 3.2 Categories

Every item belongs to exactly one category. Version 1 includes these defaults:

- Health
- Home
- Digital life
- Devices
- Vehicle
- Other

A category has a name, icon, color, and display order. Users can add, rename,
recolor, reorder, archive, and restore categories. Importance is an item
property, not a tag.

Version 1 intentionally avoids a multi-tag system.

### 3.3 Creating and Editing an Item

An item contains:

- name;
- category;
- schedule type and schedule rule;
- last completion date or initial due date;
- importance;
- reminder offsets;
- active, paused, archived, or deleted state.

When an item is created, the user chooses one of these starting conditions:

- provide a known previous completion date and calculate the first due date;
- directly provide the first due date;
- mark the item as never completed and provide its first reminder date.

The form previews the calculated due date and planned important reminders before
saving.

### 3.4 Completing an Item

Tapping Complete immediately records the current time and updates the next due
date. It does not open a mandatory form.

After completion:

- a short-lived Undo action appears;
- the new completion is visible in item history;
- relative schedules recalculate from that completion;
- fixed-calendar schedules advance to their next calendar occurrence;
- outstanding reminders for the completed occurrence are cancelled.

The overflow menu offers:

- complete with an optional note;
- record a completion on a past date;
- skip the current fixed-calendar occurrence;
- pause the item.

Each completion stores a timestamp and an optional short note. Notes are not
required and never block one-tap completion.

Skipping is only available for fixed-calendar schedules. A skip creates a
separate historical record and does not create a false completion. Relative
schedules cannot be skipped because their next date requires a completion
baseline.

Editing or removing a historical completion requires confirmation because it
can change the calculated due date.

### 3.5 Item Detail

The item detail screen displays:

- current state;
- time since last completion;
- next due date;
- schedule rule;
- reminder rules;
- completion and skip history;
- notes attached to completions;
- edit, pause, archive, restore, and delete actions.

Archive is the normal removal action and preserves history. Permanent deletion
requires a second confirmation.

### 3.6 Settings

Settings include:

- time zone;
- daily digest time;
- default due-soon window;
- quiet hours;
- notification status for each device;
- daily-digest and important-reminder toggles per device;
- device session management;
- password change;
- synchronization status;
- full JSON export;
- CSV export of items and completion history;
- restore/import preview;
- application and server version information.

The default time zone is Asia/Shanghai. The default quiet period is 22:00 to
08:00 local time.

## 4. Scheduling Rules

Version 1 supports two schedule families.

### 4.1 Completion-Relative Schedules

A completion-relative schedule becomes due a configured interval after the most
recent completion.

Supported units:

- days;
- weeks;
- calendar months;
- calendar years.

Examples include every 30 days, every 12 weeks, every 6 months, or every year.

Calendar-month and calendar-year arithmetic use the last valid day when the
target date does not exist. For example, one month after January 31 is February
28 or February 29. One year after February 29 is February 28 in a non-leap
year.

Completing early or late moves the next due date because the latest completion
becomes the new baseline.

### 4.2 Fixed-Calendar Schedules

A fixed-calendar schedule remains anchored to the calendar. Version 1 supports:

- a selected day every month;
- a selected month and day every year.

If a selected monthly day does not exist in a shorter month, the last valid day
of that month is used. A yearly February 29 occurrence falls on February 28 in
a non-leap year.

Completing early or late does not permanently shift later occurrences. Skipping
the current occurrence advances to the next fixed occurrence without adding a
completion.

### 4.3 Status Calculation

Dates are stored as UTC instants where a precise timestamp is meaningful.
Calendar occurrences are evaluated in the user's configured time zone.

An item is:

- Overdue when its due date is before the current local calendar date;
- Due today when its due date is the current local calendar date;
- Due soon when its due date is within the configured due-soon window;
- Not started when it has no completion and its initial due date is farther away
  than the due-soon window;
- Healthy when it has at least one completion and is otherwise outside the
  due-soon window;
- Paused or archived when explicitly placed in those states.

The temporal states take priority for a never-completed item. For example, a
never-completed item moves from Not started to Due soon, Due today, and Overdue
as its initial due date approaches and passes.

The server is authoritative for persisted next-due values. Clients use the same
rules for offline display and form previews. A shared set of scheduling test
vectors is executed against both the TypeScript client implementation and the
Go server implementation to prevent divergent results.

## 5. Notifications

### 5.1 Daily Digest

The daily digest is sent at a configurable local time and contains:

- number of overdue items;
- number of items due today;
- number of due-soon items;
- up to several highest-priority item names.

No digest is sent when there are no overdue, due-today, or due-soon items. At
most one digest is sent to each enabled device per local day. Opening the
notification navigates to the filtered dashboard.

### 5.2 Important Reminders

An item marked important may enable one or more reminder offsets:

- 30 days before;
- 7 days before;
- 3 days before;
- 1 day before;
- on the due date.

Version 1 does not send an individual reminder every day after an item becomes
overdue. Overdue items remain in the daily digest.

Reminders falling inside quiet hours are delayed until the end of quiet hours.
LastDone does not implement a critical-alert mode that bypasses operating
system controls.

### 5.3 Device Defaults

Notification settings are independent for every registered device.

The recommended initial configuration is:

- iPhone: daily digest and important reminders;
- Android: important reminders only;
- desktop browser: both disabled until explicitly enabled.

These are recommendations shown during setup, not immutable rules.

### 5.4 Delivery

iPhone Home Screen and desktop browser notifications use standards-based Web
Push delivered by the VPS. Permission is only requested after an explicit user
action.

Where the platform supports application badges, the application icon shows the
current overdue count. Badge support is an enhancement and is not required for
delivery of the underlying notification.

Android uses local notifications scheduled from synchronized server data. It
does not depend on Google Firebase Cloud Messaging. The client reconciles its
notification schedule after synchronization, application launch, return to
foreground, network restoration, and operating-system background opportunities.
The user interface reports missing notification permission or restrictive
battery settings.

Every notification has an idempotency identity formed from:

- user;
- item or digest date;
- due occurrence;
- reminder type and offset;
- destination device.

Retries, server restarts, and repeated scheduler executions therefore do not
generate duplicate notifications. Completing, skipping, pausing, archiving, or
rescheduling an item invalidates obsolete reminder jobs.

## 6. Client Architecture

### 6.1 Web Application

The primary client is a React and TypeScript progressive web application built
with Vite. The same responsive application serves iPhone Home Screen and desktop
browser users.

The PWA includes:

- a web app manifest;
- iPhone-compatible Home Screen metadata and icons;
- a service worker for application-shell caching;
- offline navigation;
- controlled application updates;
- Web Push subscription management.

Hashed static assets can be cached for a long duration. The service worker file
must always be revalidated so clients discover new versions promptly.

### 6.2 Android Application

Capacitor packages the web application as a signed Android APK. The Android
layer is intentionally thin and is responsible for:

- native local notifications;
- notification permission checks;
- application lifecycle integration;
- secure device-specific session storage where appropriate;
- deep links from notifications;
- application version reporting.

Business rules and screens remain in the shared web application.

### 6.3 Local Storage

Each client stores a complete usable data set in IndexedDB, accessed through a
small repository abstraction. Local data includes:

- items and categories;
- completions and skips;
- settings needed for offline display;
- the device record;
- the last acknowledged server sequence;
- pending outbound operations;
- unresolved conflicts.

Every user action first commits locally and updates the screen. Network
availability does not block normal use.

## 7. Server Architecture

The server is a custom Go binary embedding PocketBase as an application
framework. PocketBase supplies SQLite persistence, authentication, record
management, migrations, and an administrative interface. Custom Go packages
provide:

- synchronization endpoints;
- operation idempotency;
- field-level conflict checks;
- schedule validation;
- Web Push;
- notification scheduling;
- backup policy;
- health checks.

The built PWA is served by the same process, leaving one container and one
network port.

### 7.1 Collections and Internal Tables

Business collections:

- users: application users authenticated by username and password;
- categories: user-owned category definitions;
- items: user-owned recurring items and current derived schedule state;
- completions: append-oriented completion records;
- skips: fixed-calendar occurrence skips;
- devices: device sessions and notification capabilities;
- user_settings: time zone, digest, quiet-hour, and default preferences;
- push_subscriptions: browser Web Push subscriptions;
- notification_log: idempotent delivery history.

Synchronization support:

- sync_changes: monotonic server sequence and changed-record metadata;
- processed_operations: client operation IDs already applied;
- sync_conflicts: rejected overlapping edits and their two versions.

Every business record contains a user owner. API authorization rules verify the
authenticated user rather than trusting a user ID supplied by a client.

Version 1 disables public sign-up. The sole application user is created by the
administrator. A future release may add invitation-based users without changing
the ownership model.

## 8. Synchronization

### 8.1 Operation Flow

Every mutation:

1. creates a unique client operation ID;
2. changes IndexedDB immediately;
3. writes an operation to the local outbox;
4. updates the interface;
5. pushes the operation when connectivity permits.

The server applies an operation and writes its sync change in one database
transaction. Replayed operation IDs return the original result instead of
creating duplicates.

Clients pull changes after their most recently acknowledged server sequence.
The sequence avoids timestamp cursor ambiguity. Synchronization runs:

- at application launch;
- when the application returns to foreground;
- when connectivity returns;
- after a local mutation;
- periodically while open;
- after a manual refresh.

The interface exposes Synced, Pending, Offline, and Error states.

### 8.2 Merge and Conflict Policy

Completions and skips are independent records, so additions from separate
devices are preserved.

Item and category edits are submitted as field patches with a base revision:

- edits to disjoint fields merge automatically;
- an edit to a field unchanged on the server applies normally;
- concurrent edits to the same field produce a conflict.

A same-field conflict is stored server-side and presented with both values.
Neither version is silently discarded. The user selects a result, creating a
new synchronized revision.

Archive and deletion synchronize as state changes. A permanent deletion leaves
a minimal synchronization tombstone long enough for registered devices to
acknowledge it; the deleted payload is removed.

### 8.3 Authentication and Offline Sessions

Initial sign-in requires a network connection. The application account uses a
username and password; email delivery is not required.

After a successful sign-in:

- each device receives its own revocable session;
- cached data remains readable offline;
- offline changes remain queued if the server session expires;
- reauthentication resumes synchronization without clearing local data.

Password reset is performed through the private PocketBase administration
interface in version 1.

## 9. Import, Export, and Backup

The user can export:

- a complete versioned JSON archive suitable for restoration;
- CSV files for items, completions, and skips.

Import always validates and previews changes before applying them. It never
silently replaces the active data set.

The server creates:

- one daily PocketBase data backup, retaining seven;
- one pre-upgrade backup when the application version changes, retaining three.

Backups live in the persistent data directory and may later be replicated to an
S3-compatible service. Large attachments are outside version 1, so expected
backup growth is small.

## 10. Repository Layout

The planned repository layout is:

    lastdone/
    ├── apps/
    │   ├── web/
    │   └── android/
    ├── server/
    │   ├── main.go
    │   ├── sync/
    │   ├── notifications/
    │   └── migrations/
    ├── packages/
    │   ├── core/
    │   └── contracts/
    ├── deploy/
    │   ├── compose.yaml
    │   ├── .env.example
    │   └── openresty.conf
    ├── Dockerfile
    └── .github/workflows/

The contracts package contains technology-neutral JSON test vectors for date,
schedule, state, and conflict behavior. Both client and server test suites must
pass these vectors.

## 11. Docker Image

The Docker image uses three stages:

1. Node.js builds the PWA.
2. Go compiles the custom PocketBase server.
3. A minimal runtime image receives only the binary, static assets, CA
   certificates, and time-zone data.

The runtime does not contain Node.js, npm, build tools, source code, or signing
keys. It runs as a non-root user and exposes port 8090.

Persistent data is mounted at /pb/pb_data. Secrets are supplied at runtime and
are not embedded in the image. The Web Push key pair is generated on first
startup and saved inside persistent data.

The application includes a built-in health-check command so the container
health check does not require curl or wget in the runtime image.

A representative Compose configuration is:

    services:
      lastdone:
        image: docker.io/OWNER/lastdone:latest
        container_name: lastdone
        restart: unless-stopped
        ports:
          - "127.0.0.1:8090:8090"
        volumes:
          - /opt/lastdone/data:/pb/pb_data
        env_file:
          - .env
        environment:
          TZ: Asia/Shanghai
          GOMEMLIMIT: 384MiB
        healthcheck:
          test: ["CMD", "/app/lastdone", "healthcheck"]
          interval: 30s
          timeout: 5s
          retries: 3

OWNER is the Docker Hub namespace selected when the public repository is
created.

## 12. Production Deployment

The target production path is:

    Clients
       |
       | HTTPS
       v
    Cloudflare
       |
       | HTTPS with Full (strict)
       v
    1Panel / OpenResty
       |
       | HTTP on loopback
       v
    127.0.0.1:8090 / LastDone container
       |
       v
    /opt/lastdone/data

The container port is never bound to a public interface.

The supplied OpenResty example:

- forwards the real client IP, host, and HTTPS protocol;
- disables proxy buffering and increases read timeout for PocketBase realtime
  event streams;
- disables caching for APIs and authentication;
- revalidates the service worker;
- permits long caching for immutable hashed assets;
- blocks the PocketBase administration interface from public access.

Administrative access uses an SSH tunnel to 127.0.0.1:8090. The administrator
creates the first PocketBase superuser through a secure deployment command or
the tunneled administration setup, then creates the single LastDone application
user. Administrator passwords are never stored in Compose or application
environment variables.

Cloudflare, OpenResty, and PocketBase rate limits protect public authentication.
PocketBase settings encryption is enabled with a random runtime secret.

## 13. Continuous Integration and Releases

Pull requests and regular commits run:

- TypeScript formatting, linting, type checking, and unit tests;
- Go formatting, static analysis, and unit tests;
- the shared scheduling contract suite in TypeScript and Go;
- synchronization idempotency and conflict tests;
- production PWA build;
- Docker image build;
- a real container health check;
- browser end-to-end tests against the running container.

Release tags use semantic versioning. A v1.2.0 tag produces:

- linux/amd64 Docker image;
- linux/arm64 Docker image;
- Docker Hub tags latest, 1, 1.2, 1.2.0, and the commit SHA;
- a signed release APK;
- a GitHub Release;
- Compose and environment-example files;
- SHA-256 checksums;
- release notes.

The Android signing key is encrypted in GitHub Actions secrets. APKs never
contain account credentials, server private keys, Cloudflare credentials, or
administrator credentials.

The VPS is not silently auto-updated. The owner chooses when to pull and restart
the stable image through 1Panel or Docker Compose.

## 14. Upgrade and Recovery

When a container starts with a new application version:

1. the server detects the version change;
2. it creates a pre-upgrade backup before database migrations;
3. it applies pending versioned migrations;
4. it starts the HTTP service;
5. Docker evaluates the health check.

If startup or health checks fail, the unhealthy version does not replace a
known-good public service indefinitely. Recovery pins the previous Docker tag
and, when a schema change requires it, restores the matching pre-upgrade backup.

Application and database versions are visible in settings and health output.

## 15. Error Handling

User-visible errors are phrased as recoverable states:

- Offline: edits are accepted locally and marked pending.
- Authentication expired: local data and pending edits remain; sign-in resumes
  synchronization.
- Sync rejected: the operation remains available for retry or conflict review.
- Notification permission denied: the device stays registered without
  notification delivery and shows instructions.
- Server unavailable: exponential retry with a manual retry action.
- Migration failure: the server does not continue with a partially migrated
  schema.
- Import invalid: no records are committed; validation errors identify affected
  entries.

No normal network or authentication error clears IndexedDB automatically.

## 16. Testing Strategy

Critical unit-test areas include:

- relative and fixed schedule calculations;
- month-end and leap-year handling;
- early, late, backdated, undone, edited, and deleted completions;
- fixed-occurrence skips;
- state calculation around midnight and time-zone changes;
- notification idempotency and quiet-hour deferral;
- outbox retry and operation replay;
- field-level merging and conflict creation;
- archive, restore, deletion tombstones, export, and import validation.

Integration tests use a real temporary PocketBase database. End-to-end tests
cover:

- first sign-in;
- creating an item from a previous completion;
- creating an item from an initial due date;
- offline completion and later synchronization;
- edits on two simulated devices;
- completion on one client appearing on another;
- PWA installation metadata;
- Docker startup with a persistent volume;
- database migration and backup behavior.

Manual release checks cover installation on an iPhone Home Screen, current
desktop browsers, and the target Redmi Android device.

## 17. Implementation Phases

Development follows the user-facing platform priorities.

### Phase 1: Core PWA

- scheduling domain and contract tests;
- PocketBase server and migrations;
- username authentication;
- dashboard, categories, items, completion history, and settings;
- IndexedDB and offline operation queue;
- synchronization and conflict handling;
- responsive desktop layout;
- installable iPhone PWA.

### Phase 2: Notifications

- device registration;
- browser Web Push;
- daily digest;
- important reminders;
- quiet hours;
- deduplication and notification settings.

### Phase 3: Production Distribution

- hardened Docker image;
- Compose and OpenResty examples;
- automatic backup and upgrade path;
- GitHub Actions;
- multi-architecture Docker Hub releases;
- release documentation.

### Phase 4: Android APK

- Capacitor wrapper;
- local notification scheduling;
- lifecycle synchronization;
- signing and GitHub Release publishing;
- installation and upgrade testing on the Redmi device.

## 18. Version 1 Acceptance Criteria

Version 1 is complete when:

- the same account and data work on iPhone PWA, desktop browser, and Android
  APK;
- clients can view and change data while offline;
- queued changes synchronize without duplicate completions;
- same-field concurrent edits cannot be silently lost;
- both relative and fixed-calendar schedules pass shared edge-case tests;
- daily digests and important reminders respect device settings and quiet hours;
- Docker deployment persists data across container replacement;
- amd64 and arm64 images are published to Docker Hub;
- a signed APK is attached to the GitHub Release;
- upgrades create recoverable backups before migrations;
- the public reverse proxy cannot reach the PocketBase administration interface;
- JSON export can restore the complete application data set.

## 19. Explicitly Deferred Work

The following are excluded from version 1:

- open registration;
- multiple active users;
- family sharing;
- email verification and password recovery;
- attachments and photographs;
- Google, Apple, or other social login;
- app-store distribution;
- iOS native application;
- general tasks, habits, journals, and free-form notes;
- public profiles;
- analytics or telemetry;
- automatic VPS updates;
- daily per-item overdue notifications;
- Google Firebase dependency for Android notifications.

These exclusions keep the first release focused on a reliable personal recurring
maintenance workflow.
