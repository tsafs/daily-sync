#!/usr/bin/env bash
# Test script for SYNC_MODE=webdav.
#
# DEBUG=true causes the container to run one backup immediately and exit.
#
# GFS retention env vars:
#   RETAIN_DAILY  — keep all backups from the last N days         (default: 7)
#   RETAIN_WEEKLY — keep one backup per week for the last N weeks  (default: 4)
#   RETAIN_MONTHLY— keep one backup per month for the last N months(default: 6)

sudo docker run --rm \
    -v "$(pwd)/test_data/small:/data:ro" \
    -e SYNC_MODE="webdav" \
    -e WEBDAV_URL="https://nextcloud05.webo.cloud/remote.php/dav/files/sebastian.fast%40posteo.net" \
    -e WEBDAV_USERNAME="sebastian.fast@posteo.net" \
    -e WEBDAV_PASSWORD="'}:5KpI,(DpU)eT9oXH\`" \
    -e WEBDAV_TARGET_DIR="/test" \
    -e CHUNK_SIZE_MB=20 \
    -e USE_ENCRYPTION=false \
    -e RETAIN_DAILY=3 \
    -e RETAIN_WEEKLY=2 \
    -e RETAIN_MONTHLY=1 \
    -e CRON_SCHEDULE="16 13 * * *" \
    -e DEBUG=true \
    daily-sync