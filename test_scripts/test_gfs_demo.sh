#!/usr/bin/env bash
# Demonstrates Grandfather-Father-Son (GFS) retention configuration.
#
# Runs three separate backup cycles back-to-back against a local disk target
# so you can observe how GFS retention prunes old backups.
#
# GFS tier overview:
# ┌─────────────┬──────────────────────────────────────────┬────────────┐
# │ Tier        │ Meaning                                  │ Env var    │
# ├─────────────┼──────────────────────────────────────────┼────────────┤
# │ Daily (Son) │ Every backup from the last N days        │RETAIN_DAILY│
# │ Weekly (Fat)│ Oldest backup per week, last N weeks     │RETAIN_WEEKLY│
# │ Monthly(Gpa)│ Oldest backup per month, last N months   │RETAIN_MONTHLY│
# └─────────────┴──────────────────────────────────────────┴────────────┘
#
# With defaults (daily=7, weekly=4, monthly=6) you store ~17 backups but
# retain 6 months of recovery depth.
#
# Usage:
#   chmod +x test_scripts/test_gfs_demo.sh
#   ./test_scripts/test_gfs_demo.sh
#
# After each run, inspect ./test_target to see the retained backup directories.

set -euo pipefail

IMAGE="daily-sync"
DATA_DIR="$(pwd)/test_data/small"
TARGET_DIR="$(pwd)/test_target"

run_backup() {
    local label="$1"
    echo ""
    echo "=== Running backup: ${label} ==="
    sudo docker run --rm \
        -v "${DATA_DIR}:/data:ro" \
        -v "${TARGET_DIR}:/target" \
        -e SYNC_MODE="disk" \
        -e USE_ENCRYPTION=false \
        -e RETAIN_DAILY=7 \
        -e RETAIN_WEEKLY=4 \
        -e RETAIN_MONTHLY=6 \
        -e CRON_SCHEDULE="0 2 * * *" \
        -e DEBUG=true \
        "${IMAGE}"
}

echo "GFS retention demo — running 3 backup cycles"
echo "Target directory: ${TARGET_DIR}"
echo ""

run_backup "cycle 1"
echo "--- Backups after cycle 1 ---"
ls -1 "${TARGET_DIR}/" 2>/dev/null || echo "(empty)"

run_backup "cycle 2"
echo "--- Backups after cycle 2 ---"
ls -1 "${TARGET_DIR}/" 2>/dev/null || echo "(empty)"

run_backup "cycle 3"
echo "--- Backups after cycle 3 ---"
ls -1 "${TARGET_DIR}/" 2>/dev/null || echo "(empty)"

echo ""
echo "Done. Inspect ${TARGET_DIR} to verify GFS retention applied correctly."
