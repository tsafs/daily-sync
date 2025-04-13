# WebDAV Daily Sync

WebDAV Daily Sync is a lightweight solution for syncing files to a WebDAV server. It supports optional encryption using password-protected zip files (AES-256) and is designed to run as a Docker container with a configurable cron schedule.

## Features
- Sync files to a WebDAV server.
- Optional encryption using password-protected zip files.
- Configurable cron schedule for automated syncing.
- Debug mode for manual testing.

## Docker Hub

This Docker image is available on Docker Hub under the tag `sebastianfa57/webdav-daily-sync:1.0.0`. You can pull it directly using:

```bash
docker pull sebastianfa57/webdav-daily-sync:1.0.0
```

## Prerequisites
- Docker installed on your system.
- A WebDAV server with valid credentials.

## Build the Docker Image

To build the Docker image locally, run:

```bash
docker build -t webdav-daily-sync .
```

## Run the Container Directly

### Production Mode

Run the container in production mode with the following command:

```bash
docker run -d \
    --name webdav-sync \
    --privileged \
    -v /path/to/your/data:/data \
    -e WEBDAV_URL="https://<webdav-host>/remote.php/dav/files/<username>/<folder>" \
    -e WEBDAV_USERNAME="<username>" \
    -e WEBDAV_PASSWORD="<password>" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e CRON_TIME="<time>" \
    -e CRON_DAYS="<days>" \
    -e TIMEZONE="Europe/Berlin" \
    sebastianfa57/webdav-daily-sync:1.0.0
```

### Debug Mode

Run the container in debug mode to test the sync process manually. This effectively disables cron for testing purposes:

```bash
docker run --rm \
    --privileged \
    -v ./test_data:/data \
    -e WEBDAV_URL="https://<webdav-host>/remote.php/dav/files/<username>/<folder>" \
    -e WEBDAV_USERNAME="<username>" \
    -e WEBDAV_PASSWORD="<password>" \
    -e WEBDAV_TARGET_DIR="/test" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e DEBUG=true \
    sebastianfa57/webdav-daily-sync:1.0.0
```

## Run the Container with Docker Compose

Create a `docker-compose.yml` file with the following content:

```yaml
version: '3.8'
services:
  webdav-sync:
    image: sebastianfa57/webdav-daily-sync:1.0.0
    container_name: webdav-sync
    privileged: true
    volumes:
      - /path/to/your/data:/data
    environment:
      WEBDAV_URL: "https://<webdav-host>/remote.php/dav/files/<username>/<folder>"
      WEBDAV_USERNAME: "<username>"
      WEBDAV_PASSWORD: "<password>"
      USE_ENCRYPTION: "true"
      ENCRYPTION_PASSWORD: "<password-for-encryption>"
      CRON_TIME: "<time>"
      CRON_DAYS: "<days>"
```

Start the container with:

```bash
docker-compose up -d
```

## Environment Variables

| Variable         | Description                                                                        | Default Value |
|------------------|------------------------------------------------------------------------------------|---------------|
| `WEBDAV_URL`     | URL of the WebDAV server.                                                          | None          |
| `WEBDAV_USERNAME`| Username for the WebDAV server.                                                    | None          |
| `WEBDAV_PASSWORD`| Password for the WebDAV server.                                                    | None          |
| `USE_ENCRYPTION` | Whether to encrypt the files before syncing (`true` or `false`).                   | `true`        |
| `ENCRYPTION_PASSWORD`   | Password for encrypting the zip file. Required if `USE_ENCRYPTION` is true. | None          |
| `CRON_TIME`      | Cron schedule time (e.g., `0 2` for 2:00 AM, `30 22` for 22:30).                   | `0 2`         |
| `CRON_DAYS`      | Days for the cron job (e.g., `*` for every day, `0` for Sunday, `1,3,5` for Monday, Wednesday, and Friday). | `*`           |
| `DEBUG`          | Enable debug mode to skip cron and run the sync script directly.                   | `false`       |
| `TIMEZONE`       | Timezone for cron jobs (e.g., `Europe/Berlin`, `UTC`). See [IANA Time Zone Database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) for valid values. | None          |

## Timezone Configuration

The container supports timezone configuration to ensure cron jobs run at the correct local time, including adjustments for daylight saving time (DST).

### Default Behavior
If the `TIMEZONE` variable is unset and the `/etc/localtime` and `/etc/timezone` files are not mounted, the container will use the default timezone of the base image. This could lead to unexpected behavior. To avoid this, you should either use the host's timezone or set the `TIMEZONE` variable explicitly.

### Using the Host's Timezone

To use the host's timezone, you can mount the `/etc/localtime` and `/etc/timezone` files into the container. This is supported on Linux systems where these files are available. For example:

```bash
docker run -d \
    --name webdav-sync \
    --privileged \
    -v /path/to/your/data:/data \
    -v /etc/localtime:/etc/localtime:ro \
    -v /etc/timezone:/etc/timezone:ro \
    -e WEBDAV_URL="https://<webdav-host>/remote.php/dav/files/<username>/<folder>" \
    -e WEBDAV_USERNAME="<username>" \
    -e WEBDAV_PASSWORD="<password>" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e CRON_TIME="<time>" \
    -e CRON_DAYS="<days>" \
    sebastianfa57/webdav-daily-sync:1.0.0
```

This approach works on most Linux distributions that use `/etc/localtime` and `/etc/timezone` for timezone configuration. Note that this method is not supported on systems like macOS or Windows, as they do not use these files for timezone management.

### Using the `TIMEZONE` Variable
If you explicitly set the `TIMEZONE` variable, this ensures that the container uses the specified timezone, regardless of whether the timezone files are mounted. For example:

```bash
docker run -d \
    --name webdav-sync \
    --privileged \
    -v /path/to/your/data:/data \
    -e WEBDAV_URL="https://<webdav-host>/remote.php/dav/files/<username>/<folder>" \
    -e WEBDAV_USERNAME="<username>" \
    -e WEBDAV_PASSWORD="<password>" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e CRON_TIME="<time>" \
    -e CRON_DAYS="<days>" \
    -e TIMEZONE="Europe/Berlin" \
    sebastianfa57/webdav-daily-sync:1.0.0
```

Setting the `TIMEZONE` variable to a UTC-based value (e.g., `UTC`) ensures that the container operates without being affected by daylight saving time (DST) changes, providing consistent scheduling behavior.

## License

Copyright (c) 2025, Sebastian Fast
All rights reserved.

This source code is licensed under the GPL-style license found in the
LICENSE file in the root directory of this source tree. 