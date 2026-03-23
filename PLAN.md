# Plan: TypeScript Backup Library Rewrite

## Summary

Replace the three bash scripts (`sync_webdav.sh`, `sync_ftp.sh`, `sync_directory.sh`) with a TypeScript library built around a **provider-based architecture**. Each backup target (Disk, WebDAV, FTP) is a provider implementing a common interface. The library handles archiving (7z via child process), scheduling, structured logging, GFS retention, integrity verification, and retry logic — providers only implement upload/list/delete.

The Docker container model stays: one container per target. The architecture is extensible for future providers (e.g. USB auto-discovery). 7z remains for archive creation since no pure-TS solution supports AES-256 encrypted ZIPs.

A **Grandfather-Father-Son (GFS)** retention scheme replaces the simple "keep N backups" model, ensuring months of recovery depth instead of days.

---

## Architecture

```
src/
├── index.ts                  # Entry point / orchestrator
├── config.ts                 # Env var loading + validation
├── providers/
│   ├── provider.ts           # Provider interface
│   ├── disk.ts               # DiskProvider (local/NAS directory)
│   ├── webdav.ts             # WebDavProvider
│   └── ftp.ts                # FtpProvider
├── services/
│   ├── archiver.ts           # 7z wrapper
│   ├── retention.ts          # GFS retention logic
│   ├── scheduler.ts          # node-cron wrapper
│   ├── logger.ts             # pino structured logging
│   ├── integrity.ts          # Post-upload checksum verification
│   ├── retry.ts              # Exponential backoff wrapper
│   └── notifier.ts           # Email notifications on failure/success
└── __tests__/
    ├── config.test.ts
    ├── retention.test.ts
    ├── archiver.test.ts
    └── providers/
        ├── disk.test.ts
        ├── webdav.test.ts
        └── ftp.test.ts
```

---

## Steps

### 1. Initialize TypeScript project

Create a `src/` directory at the project root. Set up:

- `package.json` with `"type": "module"`
- `tsconfig.json` targeting Node 20+ (ES2022, NodeNext module resolution)
- Dev dependencies: `typescript`, `@types/node`, `vitest`
- Runtime dependencies: `basic-ftp`, `webdav`, `node-cron`, `pino`, `nodemailer`

### 2. Define the provider interface — `src/providers/provider.ts`

The plugin contract every backup target must implement:

```ts
interface BackupProvider {
  name: string
  initialize(config: ProviderConfig): Promise<void>
  upload(localPath: string, remotePath: string): Promise<void>
  list(remotePath: string): Promise<string[]>
  delete(remotePath: string): Promise<void>
  mkdir(remotePath: string): Promise<void>
  dispose(): Promise<void>
}
```

Each provider gets its own config type extending a base `ProviderConfig`. This interface is intentionally minimal — future providers (e.g. USB) only need to implement these 6 methods.

### 3. Implement `DiskProvider` — `src/providers/disk.ts`

Uses `fs/promises` for all operations. Replaces `sync_directory.sh`.

- Handles ownership matching (the current `stat`/`chown` behavior) via `fs.stat()` and `fs.chown()` on the target directory
- Serves as the reference implementation — simplest provider

### 4. Implement `WebDavProvider` — `src/providers/webdav.ts`

Uses the `webdav` npm package (pure JS WebDAV client). Replaces `sync_webdav.sh` + rclone.

- Creates remote directories
- Uploads files with streaming (avoids memory issues)
- Lists directories for retention cleanup
- Eliminates the rclone dependency entirely

### 5. Implement `FtpProvider` — `src/providers/ftp.ts`

Uses the `basic-ftp` npm package (pure JS, well-maintained, supports TLS). Replaces `sync_ftp.sh` + lftp.

- Uses a single persistent connection with proper cleanup (no lftp subprocess spawning)
- **Eliminates the memory leak risk** from spawning lftp subprocesses
- Supports upload timeouts natively
- Enables TLS by default (fixing the current `ftp:ssl-allow no` insecurity)

### 6. Build the archive service — `src/services/archiver.ts`

Wraps `7z` via `child_process.execFile()` (not `exec` — avoids shell injection).

- Copies `/data` to a temp directory
- Creates encrypted or unencrypted archives
- Multi-volume splitting (`-v` flag)
- Returns the list of created archive file paths
- Cleans up temp files on success or failure (using `try/finally`, not bash traps)

This is a clean abstraction over what all three bash scripts duplicated.

### 7. Build the GFS retention service — `src/services/retention.ts`

Implements Grandfather-Father-Son (GFS) backup rotation. See [Retention Policy](#retention-policy-gfs) below for full details.

Given a provider, remote path, and GFS config, this service:

1. Lists all remote backup directories (format: `backup_YYYYMMDD_HHMMSS/`)
2. Parses timestamps from directory names
3. Determines which backups to **keep** by evaluating each tier:
   - **Daily**: all backups from the last N days
   - **Weekly**: the oldest backup from each of the last N weeks
   - **Monthly**: the oldest backup from each of the last N months
4. Computes the union of all "keep" sets
5. Deletes everything not in the keep set

### 8. Build the scheduler — `src/services/scheduler.ts`

Uses `node-cron` (lightweight, no system cron dependency).

- Parses the same `CRON_TIME` + `CRON_DAYS` format for backward compatibility
- In debug mode, runs immediately and exits
- Removes the dependency on system cron and the fragile `/etc/environment` serialization hack

### 9. Build the config loader — `src/config.ts`

Reads and validates all environment variables with proper typing.

- Uses a discriminated union type based on `SYNC_MODE` (`disk | webdav | ftp`)
- Mode-specific variables are only required for the relevant mode
- GFS config with backward compatibility (see env vars below)
- Validates at startup with clear error messages
- Replaces the validation logic currently in `entrypoint.sh`

### 10. Build structured logging — `src/services/logger.ts`

Uses `pino` (fast, structured JSON logger).

- Every log entry includes: timestamp, level, provider name, backup ID (timestamp-based), message
- Output goes to stdout (Docker logging best practice)
- Replaces the current `echo` statements and `/var/log/cron.log` redirect

### 11. Build the orchestrator — `src/index.ts`

Main entry point. Flow:

1. Load and validate config
2. Instantiate the appropriate provider based on `SYNC_MODE`
3. If debug mode → run backup immediately, exit
4. Otherwise → register the cron schedule, keep process alive

A single backup run:

1. Create archive (archiver service)
2. Create remote backup directory (`backup_YYYYMMDD_HHMMSS/`)
3. Upload all archive volumes
4. Verify upload integrity (integrity service)
5. Run GFS retention cleanup
6. Clean up local temp files

### 11a. Error handling and process lifecycle

The Node process is the container's PID 1 and runs indefinitely. Error handling follows two tiers:

**Recoverable: a backup run fails** (provider throws, 7z exits non-zero, network timeout, disk full on remote, etc.)

- The entire `runBackup()` call is wrapped in `try/catch`
- On failure: log the error with full context, clean up temp files, **send failure notification** (if configured)
- The cron schedule stays registered, the process stays alive
- Next scheduled run attempts a fresh backup
- No partial backup directories are left on the remote — if upload fails partway through, the incomplete remote directory is deleted (best-effort cleanup)

**Unrecoverable: the Node process itself crashes** (unhandled exception, OOM, segfault)

- The container exits with a non-zero code
- Docker restart policy (`restart: unless-stopped` or `restart: always`) restarts the container
- The process re-initializes: loads config, creates provider, registers cron schedule
- No state is lost — there is no in-process state that needs persisting between restarts

**Safeguards:**

- `process.on('unhandledRejection', ...)` — log and **do not** crash (a forgotten `await` in a backup run shouldn't kill the scheduler)
- `process.on('uncaughtException', ...)` — log and **exit** (the process is in an unknown state, let Docker restart it)
- `process.on('SIGTERM', ...)` and `process.on('SIGINT', ...)` — graceful shutdown: if a backup is in progress, wait for it to finish (with a timeout), then dispose the provider and exit cleanly
- A **liveness indicator**: log a heartbeat message every hour (or on each cron tick) so you can tell from logs that the process is alive between backup runs, not silently dead

**Docker Compose recommendation:**

```yaml
services:
  backup-webdav:
    image: daily-sync:latest
    restart: unless-stopped
    environment:
      - SYNC_MODE=webdav
      # ...
```

### 12. Add integrity verification — `src/services/integrity.ts`

After uploading each volume, compute SHA-256 of the local file. For providers that support it (Disk, WebDAV via GET), download and verify the checksum matches. Log warnings for providers where verification isn't practical (FTP without HASH extension).

**New feature** — none of the bash scripts verify uploads.

### 13. Add retry logic — `src/services/retry.ts`

Wrap provider upload calls with exponential backoff (3 attempts, 5s / 15s / 45s delays).

**New feature** — a transient network error no longer means a lost backup cycle.

### 14. Add email notifications — `src/services/notifier.ts`

Uses `nodemailer` (pure JS SMTP client, zero native dependencies).

- **`NotificationService` interface** with a single method: `notify(event: BackupEvent): Promise<void>` — extensible for future channels (ntfy, Gotify, webhooks)
- **`EmailNotifier` implementation** sends an email via SMTP on backup events
- Triggered from the orchestrator's `try/catch`:
  - On **failure** (default): includes error message, provider name, timestamp, and backup ID
  - On **success** (opt-in): includes archive size, volume count, upload duration
- A failed notification is **logged but never crashes the process** — notification errors are swallowed with a warning log
- Email subject format: `[daily-sync] Backup FAILED — webdav` or `[daily-sync] Backup OK — disk`

### 15. Write tests

Use `vitest`:

- **Unit tests**: config validation, GFS retention logic (many edge cases), archive filename parsing
- **Integration tests**: each provider using test containers or mocks
- **Test the archiver** against `test_data/small/`
- **GFS-specific tests**: verify correct backup selection across tier boundaries, single-backup edge case, backward compatibility with `RETAIN_BACKUPS`

### 16. Update Dockerfile

New Dockerfile based on `node:20-slim`:

- Install `p7zip-full` (only external dependency)
- Copy built JS (from `npm run build`) into the image
- Set `NODE_ENV=production`
- Entrypoint: `node dist/index.js`
- No more rclone, lftp, rsync, cron, wget dependencies

### 17. Update test scripts

Update `test_scripts/` to use the new Docker image. Same env var interface, so existing `docker run` commands only need the image name changed. Add test cases for GFS retention env vars.

### 18. Prepare for future USB provider

The provider interface is designed so a future `UsbProvider` in `src/providers/usb.ts` would:

- Use `node-usb` or poll `/dev/disk/by-id/` to detect USB insertion
- Mount the device to a temp path
- Delegate to `DiskProvider` for the actual file operations
- Unmount and clean up on completion
- No changes needed to the orchestrator, archiver, retention, or scheduler

---

## Retention Policy (GFS)

### Problem

With simple `RETAIN_BACKUPS=3`, you keep 3 days of backups. If your database silently corrupts (bad migration, disk error, ransomware), you have a **3-day window** to notice. After that, every backup contains corrupt data.

### Solution: Grandfather-Father-Son tiers

| Tier | Meaning | Default | Kept |
|------|---------|---------|------|
| **Daily** (Son) | Every backup from the last N days | `7` | 7 backups |
| **Weekly** (Father) | One backup per week, last N weeks | `4` | 4 backups |
| **Monthly** (Grandfather) | One backup per month, last N months | `6` | 6 backups |

With the defaults (`daily: 7, weekly: 4, monthly: 6`) you keep **~17 backups** but have **6 months of recovery depth**.

### How it works

Every run produces a daily backup. **Retention cleanup** decides which old backups to keep:

1. All backups from the last 7 days → keep (daily tier)
2. For each of the last 4 weeks, keep the **oldest** backup from that week (closest to start-of-week snapshot)
3. For each of the last 6 months, keep the **oldest** backup from that month
4. A backup can satisfy multiple tiers (e.g., oldest-in-week AND oldest-in-month) — it's a union of keep sets
5. Delete everything else

A backup that was "daily" on Monday automatically becomes the "weekly" representative when the week rolls over, and eventually the "monthly" representative. No promotion logic needed — it's purely a pruning decision at cleanup time.

### Corruption recovery windows

| Scenario | Recovery |
|----------|----------|
| Noticed in 1–7 days | Pick from 7 daily backups |
| Noticed in 1–4 weeks | Pick from weekly snapshots |
| Noticed in 1–6 months | Pick from monthly snapshots |

Corruption must go unnoticed for >6 months to lose all clean backups.

### Environment variables

```
RETAIN_DAILY=7       # Keep backups from last 7 days
RETAIN_WEEKLY=4      # Keep 1 backup per week for the last 4 weeks
RETAIN_MONTHLY=6     # Keep 1 backup per month for the last 6 months
```

**Backward compatibility**: If only `RETAIN_BACKUPS` is set (old behavior), it acts as daily-only retention with no weekly/monthly tiers — identical to the current bash scripts' behavior.

---

## Environment Variable Reference

| Variable | Default | Modes | Required | Notes |
|----------|---------|-------|----------|-------|
| `SYNC_MODE` | `webdav` | all | always | `disk`, `webdav`, or `ftp` |
| `WEBDAV_URL` | — | webdav | yes | Server URL |
| `WEBDAV_USERNAME` | — | webdav | yes | Credentials |
| `WEBDAV_PASSWORD` | — | webdav | yes | Credentials |
| `WEBDAV_TARGET_DIR` | `/data` | webdav | no | Remote path |
| `FTP_HOST` | — | ftp | yes | Server hostname |
| `FTP_USER` | — | ftp | yes | Credentials |
| `FTP_PASSWORD` | — | ftp | yes | Credentials |
| `FTP_TARGET_DIR` | `/` | ftp | no | Remote path |
| `FTP_TLS` | `true` | ftp | no | Enable TLS (new, defaults secure) |
| `USE_ENCRYPTION` | `true` | all | no | Encrypt archives |
| `ENCRYPTION_PASSWORD` | — | all | if encryption | Archive password |
| `RETAIN_DAILY` | `7` | all | no | GFS daily tier |
| `RETAIN_WEEKLY` | `4` | all | no | GFS weekly tier |
| `RETAIN_MONTHLY` | `6` | all | no | GFS monthly tier |
| `RETAIN_BACKUPS` | — | all | no | Legacy: simple retention (disables GFS) |
| `CHUNK_SIZE_MB` | `0` | all | no | Multi-volume split size |
| `CRON_TIME` | `0 2` | all | no | `"MIN HOUR"` format |
| `CRON_DAYS` | `*` | all | no | Day-of-week (`*`, `0-6`, `1,3,5`) |
| `DEBUG` | `false` | all | no | Run immediately and exit |
| `TIMEZONE` | — | all | no | e.g. `Europe/Berlin` |
| `NOTIFY_ON_FAILURE` | `true` | all | no | Send email on backup failure |
| `NOTIFY_ON_SUCCESS` | `false` | all | no | Send email on backup success |
| `SMTP_HOST` | — | all | if notify | SMTP server hostname |
| `SMTP_PORT` | `587` | all | no | SMTP port |
| `SMTP_USER` | — | all | if notify | SMTP credentials |
| `SMTP_PASSWORD` | — | all | if notify | SMTP credentials |
| `SMTP_FROM` | — | all | if notify | Sender address |
| `SMTP_TO` | — | all | if notify | Recipient(s), comma-separated |

---

## Verification

- Run `vitest` for unit and integration tests
- Build Docker image and test each mode against existing test scripts (`test_dir.sh`, `test_ftp.sh`, `test_webdav.sh`) — same env vars, same behavior
- Verify encrypted archive can be extracted with `7z x -p<password>`
- Verify GFS retention: run multiple backups across simulated dates, confirm correct pruning at each tier boundary
- Verify structured JSON logs appear on stdout
- Test debug mode: immediate run + exit
- Test cron mode: container stays alive, runs on schedule
- Test backward compatibility: `RETAIN_BACKUPS=3` alone works identically to old behavior

---

## Key Decisions

| Decision | Chosen | Over | Reason |
|----------|--------|------|--------|
| Archive tool | 7z (child process) | Pure TS archiving | No npm package supports AES-256 encrypted ZIPs |
| FTP client | `basic-ftp` | lftp | Pure JS, no subprocess spawning, eliminates memory leak vector, supports TLS |
| WebDAV client | `webdav` npm | rclone | Pure JS, no binary dependency, simpler config |
| Scheduler | `node-cron` | system cron | Eliminates `/etc/environment` hack and crontab generation |
| Local target name | "disk" | filesystem / directory / volume | User preference |
| Deployment model | Separate containers per target | Multi-target single container | Keeps deployment simple, independently configurable |
| Retention policy | GFS (daily/weekly/monthly) | Simple "keep N" | Months of recovery depth, protects against silent corruption |
| Logger | `pino` | console.log / winston | Fast, structured JSON, Docker-friendly |
| Test framework | `vitest` | jest | Faster, native ESM/TS support |
| Notifications | `nodemailer` (SMTP) | SendGrid / AWS SES | No API key needed, works with any SMTP server, zero native deps |
