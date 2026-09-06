# Docker and 1Panel deployment

## Requirements

- A Linux VPS with Docker or 1Panel container management
- A domain managed by Cloudflare or another DNS provider
- HTTPS enabled on the public website
- Local port `8090` available on the VPS loopback interface

Mail service is not required. LastDone does not expose public registration and
does not use email-based password reset in its normal single-user workflow.

## Publish the Docker image

Create a Docker Hub repository named `lastdone` under the intended namespace.
For a VPS that should pull the image without Docker Hub credentials, make the
repository public.

Create a Docker Hub personal access token with Read & Write permission. Do not
use or store the account password in GitHub. In the GitHub repository, open
Settings, then Secrets and variables, then Actions, and add:

- Repository variable `DOCKERHUB_USERNAME`: the Docker Hub namespace, for
  example `getl`.
- Repository secret `DOCKERHUB_TOKEN`: the Docker Hub personal access token.

Run the `Publish Docker image` workflow with the tag `latest`. The workflow
builds and health-checks an amd64 image before publishing the amd64/arm64 image
to Docker Hub.

## 1. Create the Compose application

Copy `compose.yml` and `deploy/lastdone.env.example` to a new directory on the
VPS. Rename the example file to `.env` and change at least:

```dotenv
LASTDONE_IMAGE=getl/lastdone:latest
LASTDONE_VAPID_SUBJECT=https://lastdone.example.com
TZ=Asia/Shanghai
```

`LASTDONE_VAPID_SUBJECT` should identify the deployment. Using the public HTTPS
origin is suitable for a private installation.

In 1Panel, the same Compose content and environment values can be entered in a
Compose project. Start the project and wait for the health status to become
healthy. The persistent named volume is `lastdone_data`.

## 2. Configure the website in 1Panel

Create a website for the chosen domain. In the 1Panel reverse-proxy screen, set
the upstream to:

```text
http://127.0.0.1:8090
```

Enable HTTPS. The Compose service intentionally does not listen on the public
network interface. This repository does not install or alter OpenResty files.

If Cloudflare proxying is enabled, avoid caching `/api/*`, `/_/*`, and `sw.js`.
The application shell and hashed static assets may use normal browser/CDN
caching.

## 3. Create the administrator and application user

Create a PocketBase superuser from the container:

```bash
docker compose exec lastdone /usr/local/bin/lastdone superuser create admin@example.com 'replace-with-a-long-password'
```

Use an administrator email and a unique long password, then visit:

```text
https://lastdone.example.com/_/
```

Open the `users` collection and create one record with a username and password.
The normal LastDone login screen uses that username. Do not enable public
creation rules on the collection.

If the application password is forgotten, reset it from the PocketBase
administrator UI. This is the intended replacement for email reset.

## 4. Install the clients

- iPhone: open the site in Safari, choose Share, then Add to Home Screen.
- Desktop: open the same HTTPS address in a supported browser.
- Android: install a signed APK from the GitHub release. If the APK was built
  without a fixed server variable, enter the same HTTPS origin on first launch.

Notification permission is requested only after selecting the enable button in
LastDone settings.

## Runtime resources

The default Compose file sets `GOMEMLIMIT=384MiB`. Actual memory use depends on
database size and traffic. The persistent storage consists mainly of the
PocketBase SQLite database, Web Push keys, and retained backup archives under
`/pb/pb_data`.

The default retention is seven daily backups plus three pre-upgrade backups.
