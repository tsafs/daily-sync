# Daily Sync
Daily Sync is a lightweight solution for syncing files to various targets. It currently supports syncing to a WebDAV server, an FTP server, or another directory on the host. It was originally developed for use on NAS systems that lack built-in WebDAV sync capabilities or encryption options. It supports optional encryption using password-protected zip files (AES-256) and is designed to run as a Docker container with a configurable cron schedule.

## Features
- Sync files to a WebDAV server, FTP server, or a local directory.
- Optional encryption using password-protected zip files.
- Configurable cron schedule for automated syncing.
- Debug mode for manual testing.

## Docker Hub

This Docker image is available on Docker Hub under the tag `ghcr.io/tsafs/daily-sync:latest`. You can pull it directly using:

```bash
docker pull ghcr.io/tsafs/daily-sync:latest
```

## Prerequisites
- Docker installed on your system.
- A WebDAV server with valid credentials.

## Build the Docker Image

To build the Docker image locally, run:

```bash
docker build -t daily-sync .
```

## Run the Container Directly

### Production Mode - WebDAV Sync

Run the container in production mode to sync to WebDAV:

```bash
docker run -d \
    --name daily-sync-webdav \
    -v /path/to/your/data:/data:ro \
    -e SYNC_MODE="webdav" \
    -e WEBDAV_URL="https://<webdav-host>/remote.php/dav/files/<username>/<folder>" \
    -e WEBDAV_USERNAME="<username>" \
    -e WEBDAV_PASSWORD="<password>" \
    -e WEBDAV_TARGET_DIR="<target-directory>" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e CRON_TIME="<time>" \
    -e CRON_DAYS="<days>" \
    -e TIMEZONE="Europe/Berlin" \
    ghcr.io/tsafs/daily-sync:latest
```

### Production Mode - FTP Sync

Run the container in production mode to sync to FTP:

```bash
docker run -d \
    --name daily-sync-ftp \
    -v /path/to/your/data:/data:ro \
    -e SYNC_MODE="ftp" \
    -e FTP_HOST="<ftp-host>" \
    -e FTP_USER="<username>" \
    -e FTP_PASSWORD="<password>" \
    -e FTP_TARGET_DIR="<target-directory>" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e CRON_TIME="<time>" \
    -e CRON_DAYS="<days>" \
    -e TIMEZONE="Europe/Berlin" \
    ghcr.io/tsafs/daily-sync:latest
```

### Production Mode - Directory Sync

Run the container in production mode to sync to another directory on the host:

```bash
docker run -d \
    --name daily-sync-dir \
    -v /path/to/your/data:/data:ro \
    -v /path/to/target/directory:/target \
    -e SYNC_MODE="directory" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e CRON_TIME="<time>" \
    -e CRON_DAYS="<days>" \
    -e TIMEZONE="Europe/Berlin" \
    ghcr.io/tsafs/daily-sync:latest
```
*Note: Ensure the target directory (`/path/to/target/directory` on the host) exists. The ownership of the synced file will automatically match the ownership of the `/path/to/target/directory` on the host.*

### Debug Mode - WebDAV Sync

Run the container in debug mode to test the WebDAV sync process manually:

```bash
docker run --rm \
    -v ./test_data:/data:ro \
    -e SYNC_MODE="webdav" \
    -e WEBDAV_URL="https://<webdav-host>/remote.php/dav/files/<username>/<folder>" \
    -e WEBDAV_USERNAME="<username>" \
    -e WEBDAV_PASSWORD="<password>" \
    -e WEBDAV_TARGET_DIR="<target-directory>" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e DEBUG=true \
    ghcr.io/tsafs/daily-sync:latest
```

### Debug Mode - FTP Sync

Run the container in debug mode to test the FTP sync process manually:

```bash
docker run --rm \
    -v ./test_data:/data:ro \
    -e SYNC_MODE="ftp" \
    -e FTP_HOST="<ftp-host>" \
    -e FTP_USER="<username>" \
    -e FTP_PASSWORD="<password>" \
    -e FTP_TARGET_DIR="<target-directory>" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e DEBUG=true \
    ghcr.io/tsafs/daily-sync:latest
```

### Debug Mode - Directory Sync

Run the container in debug mode to test the directory sync process manually:

```bash
docker run --rm \
    -v ./test_data:/data:ro \
    -v ./test_target:/target \
    -e SYNC_MODE="directory" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="<password-for-encryption>" \
    -e DEBUG=true \
    ghcr.io/tsafs/daily-sync:latest
```
*Note: Ensure the target directory (`./test_target` in this example) exists. The ownership of the synced file will automatically match the ownership of the `./test_target` directory.*


## Run the Container with Docker Compose

### WebDAV Sync Example

```yaml
version: '3.8'
services:
  daily-sync-webdav:
    image: ghcr.io/tsafs/daily-sync:latest
    container_name: daily-sync-webdav
    volumes:
      - /path/to/your/data:/data:ro
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    environment:
      SYNC_MODE: "webdav"
      WEBDAV_URL: "https://<webdav-host>/remote.php/dav/files/<username>"
      WEBDAV_USERNAME: "<username>"
      WEBDAV_PASSWORD: "<password>"
      WEBDAV_TARGET_DIR: "<target-directory>"
      USE_ENCRYPTION: "true"
      ENCRYPTION_PASSWORD: "<password-for-encryption>"
      CRON_TIME: "<time>"
      CRON_DAYS: "<days>"
```

### FTP Sync Example

```yaml
version: '3.8'
services:
  daily-sync-ftp:
    image: ghcr.io/tsafs/daily-sync:latest
    container_name: daily-sync-ftp
    volumes:
      - /path/to/your/data:/data:ro
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    environment:
      SYNC_MODE: "ftp"
      FTP_HOST: "<ftp-host>"
      FTP_USER: "<username>"
      FTP_PASSWORD: "<password>"
      FTP_TARGET_DIR: "<target-directory>"
      USE_ENCRYPTION: "true"
      ENCRYPTION_PASSWORD: "<password-for-encryption>"
      CRON_TIME: "<time>"
      CRON_DAYS: "<days>"
```

### Directory Sync Example

```yaml
version: '3.8'
services:
  daily-sync-dir:
    image: ghcr.io/tsafs/daily-sync:latest
    container_name: daily-sync-dir
    volumes:
      - /path/to/your/data:/data:ro
      - /path/to/target/directory:/target
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    environment:
      SYNC_MODE: "directory"
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

| Variable         | Description                                                                        | Default Value | Required For |
|------------------|------------------------------------------------------------------------------------|---------------|--------------|
| `SYNC_MODE`      | Sync target mode (`webdav`, `directory`, or `ftp`).                                | `webdav`      | Always       |
| `WEBDAV_URL`     | URL of the WebDAV server.                                                          | None          | `webdav`     |
| `WEBDAV_USERNAME`| Username for the WebDAV server.                                                    | None          | `webdav`     |
| `WEBDAV_PASSWORD`| Password for the WebDAV server.                                                    | None          | `webdav`     |
| `WEBDAV_TARGET_DIR`| Target directory on the WebDAV server.                                           | `/data`       | `webdav` (Optional) |
| `FTP_HOST`       | Hostname or IP address of the FTP server.                                          | None          | `ftp`        |
| `FTP_USER`       | Username for the FTP server.                                                       | None          | `ftp`        |
| `FTP_PASSWORD`   | Password for the FTP server.                                                       | None          | `ftp`        |
| `FTP_TARGET_DIR` | Target directory on the FTP server.                                                | `/`           | `ftp` (Optional) |
| `USE_ENCRYPTION` | Whether to encrypt the files before syncing (`true` or `false`).                   | `true`        | Always       |
| `ENCRYPTION_PASSWORD`   | Password for encrypting the zip file. Required if `USE_ENCRYPTION` is true. | None          | If `USE_ENCRYPTION=true` |
| `RETAIN_BACKUPS` | Number of recent backups to keep in the target location. Older backups are deleted. | `1`           | Always (Optional) |
| `CHUNK_SIZE_MB`  | Maximum size (in MB) for each part of the multi-volume zip archive for WebDAV or FTP uploads. Must be > 10 MB. Internally, 10 MB is subtracted from this value as a safety margin before creating zip volumes to avoid potential size limit issues. If set to 0 or less than 11, a single archive file will be created. | `0`         | `webdav`, `ftp` (Optional) |
| `CRON_TIME`      | Cron schedule time (e.g., `0 2` for 2:00 AM, `30 22` for 22:30).                   | `0 2`         | Always (Optional) |
| `CRON_DAYS`      | Days for the cron job (e.g., `*` for every day, `0` for Sunday, `1,3,5` for Monday, Wednesday, and Friday). | `*`           | Always (Optional) |
| `DEBUG`          | Enable debug mode to skip cron and run the sync script directly.                   | `false`       | Always (Optional) |
| `TIMEZONE`       | Timezone for cron jobs (e.g., `Europe/Berlin`, `UTC`). See [IANA Time Zone Database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) for valid values. | None          | Always (Optional) |

*Note: For `directory` sync mode, the ownership of the created zip file in the target directory will automatically match the ownership of the mounted target directory itself.*

## Timezone Configuration

The container supports timezone configuration to ensure cron jobs run at the correct local time, including adjustments for daylight saving time (DST).

### Default Behavior
If the `TIMEZONE` variable is unset and the `/etc/localtime` and `/etc/timezone` files are not mounted, the container will use the default timezone of the base image. This could lead to unexpected behavior. To avoid this, you should either use the host's timezone or set the `TIMEZONE` variable explicitly.

### Using the Host's Timezone

To use the host's timezone, you can mount the `/etc/localtime` and `/etc/timezone` files into the container. This is supported on Linux systems where these files are available. For example:

```bash
docker run -d \
    --name webdav-sync \
    -v /path/to/your/data:/data:ro \
    -v /etc/localtime:/etc/localtime:ro \
    -v /etc/timezone:/etc/timezone:ro \
    ...
    ghcr.io/tsafs/daily-sync:latest
```

This approach works on most Linux distributions that use `/etc/localtime` and `/etc/timezone` for timezone configuration. Note that this method is not supported on systems like macOS or Windows, as they do not use these files for timezone management.

### Using the `TIMEZONE` Variable
If you explicitly set the `TIMEZONE` variable, this ensures that the container uses the specified timezone, regardless of whether the timezone files are mounted. For example:

```bash
docker run -d \
    --name webdav-sync \
    -v /path/to/your/data:/data:ro \
    ...
    -e TIMEZONE="Europe/Berlin" \
    ghcr.io/tsafs/daily-sync:latest
```

Setting the `TIMEZONE` variable to a UTC-based value (e.g., `UTC`) ensures that the container operates without being affected by daylight saving time (DST) changes, providing consistent scheduling behavior.

## Contribution Guidelines

I welcome contributions to the Daily Sync project! To contribute, please follow these steps:

1. **Fork the Repository**: Create a fork of this repository on GitHub.
2. **Create a Branch**: Create a new branch for your feature or bug fix. Use a descriptive name for the branch (e.g., `feature/add-logging` or `bugfix/fix-sync-issue`).
3. **Make Changes**: Implement your changes in the new branch. Ensure your code adheres to the project's coding standards and is well-documented.
4. **Test Your Changes**: Thoroughly test your changes to ensure they work as expected and do not introduce regressions.
5. **Submit a Pull Request (PR)**: Open a pull request to the `main` branch of this repository. Provide a clear description of your changes and the problem they solve.

### Reporting Issues

If you encounter a bug or have a feature request, please open an issue on GitHub. Provide as much detail as possible to help me understand and address the issue.

## Versioning

This project uses a custom versioning format stored in the `version.txt` file. The version format is:

```
YYYY-MM-DD-Index
```

- `YYYY-MM-DD`: The release date in the format year-month-day.
- `Index`: A numeric index starting at `0` for the first release of the day. If multiple releases occur on the same day, increment the index (e.g., `2025-04-13-0`, `2025-04-13-1`).

### Example

If the first release of the day is on April 13, 2025, the version would be:

```
2025-04-13-0
```

If a second release is made on the same day, the version would be:

```
2025-04-13-1
```

The `version.txt` file is located in the root directory of the project and should be updated with each release.

## License

Copyright (c) 2025, Sebastian Fast
All rights reserved.

This source code is licensed under the GPL-style license found in the
LICENSE file in the root directory of this source tree.