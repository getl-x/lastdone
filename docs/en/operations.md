# Backup, upgrade, and rollback

## Automatic backups

The server creates one daily PocketBase backup and retains the latest seven.
When an existing data directory starts with a different LastDone version, it
creates a pre-upgrade backup before applying application migrations and retains
the latest three.

Backups are stored inside the persistent volume at:

```text
/pb/pb_data/backups
```

Copy important archives to storage outside the VPS. A Docker volume is
persistent across container replacement, but it is not protection against VPS
or disk loss.

## Manual backup

Run:

```bash
docker compose exec lastdone /usr/local/bin/lastdone backup
```

The command prints the archive name. Download it from the volume through the
1Panel file/backup tools or `docker cp`.

## Client JSON backup and restore

The settings page exports a complete JSON backup containing categories, items,
completion history, skipped occurrences, user settings, and device records.
Use it to restore application data after moving to another browser, clearing
local data, or migrating the server.

Restore is a two-stage operation:

1. LastDone validates the file format, record IDs, dates, and relationships.
2. It previews how many records will be added, updated, and removed without
   changing data.
3. Data is written in one local transaction and queued for synchronization only
   after a second confirmation.

Invalid files and failed transactions do not partially replace current data.
After a restore, keep the page online until settings reports no pending changes.
Server volume backups remain the primary disaster-recovery mechanism; a client
JSON backup restores application-level records and does not replace an external
PocketBase backup.

## Upgrade

1. Confirm that an external copy of a recent backup exists.
2. Change `LASTDONE_IMAGE` to an immutable version tag such as
   `getl/lastdone:0.2.0`.
3. Pull the image and recreate the service.
4. Check container health and `https://your-domain/api/lastdone/health`.
5. Open the web application and verify synchronization before removing old
   external backups.

The startup process creates a pre-upgrade archive before migrations when the
application version changes.

## Rollback

Do not simply start an older image against a database already migrated by a
newer release.

1. Stop LastDone.
2. Preserve a copy of the current volume.
3. Restore the matching `preupgrade_lastdone_*.zip` archive using PocketBase's
   administrator backup screen or into a replacement data volume.
4. Set `LASTDONE_IMAGE` back to the previous immutable tag.
5. Start the service and verify health and synchronization.

## Health checks

The container health command is:

```bash
/usr/local/bin/lastdone healthcheck
```

The public endpoint returns application and database versions:

```text
/api/lastdone/health
```
