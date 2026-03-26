#!/usr/bin/env bash
# Test script for SYNC_MODE=ftp.
#
# DEBUG=true causes the container to run one backup immediately and exit.
# FTP_TLS defaults to true (secure by default); set FTP_TLS=false to disable.
#
# GFS retention env vars:
#   RETAIN_DAILY  — keep all backups from the last N days         (default: 7)
#   RETAIN_WEEKLY — keep one backup per week for the last N weeks  (default: 4)
#   RETAIN_MONTHLY— keep one backup per month for the last N months(default: 6)

sudo docker run --rm \
    -v "$(pwd)/test_data/small:/data:ro" \
    -e SYNC_MODE="ftp" \
    -e FTP_HOST="192.168.137.1" \
    -e FTP_USER="sondlgnas" \
    -e FTP_PASSWORD="ziznax-cyqgo2-xEnqun" \
    -e FTP_TARGET_DIR="/test" \
    -e FTP_TLS=true \
    -e CHUNK_SIZE_MB=20 \
    -e USE_ENCRYPTION=false \
    -e RETAIN_DAILY=3 \
    -e RETAIN_WEEKLY=2 \
    -e RETAIN_MONTHLY=1 \
    -e CRON_SCHEDULE="11 15 * * *" \
    -e DEBUG=true \
    daily-sync