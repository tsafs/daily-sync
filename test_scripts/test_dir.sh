#!/usr/bin/env bash
# Test script for SYNC_MODE=disk (local directory target).
#
# Mounts ./test_data/small as the source and ./test_target as the destination.
# DEBUG=true causes the container to run one backup immediately and exit.
#
# GFS retention env vars:
#   RETAIN_DAILY  — keep all backups from the last N days         (default: 7)
#   RETAIN_WEEKLY — keep one backup per week for the last N weeks  (default: 4)
#   RETAIN_MONTHLY— keep one backup per month for the last N months(default: 6)

sudo docker run --rm \
    -v "$(pwd)/test_data/small:/data:ro" \
    -v "$(pwd)/test_target:/target" \
    -e SYNC_MODE="disk" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="abc" \
    -e RETAIN_DAILY=3 \
    -e RETAIN_WEEKLY=2 \
    -e RETAIN_MONTHLY=1 \
    -e CRON_SCHEDULE="26 14 * * *" \
    -e DEBUG=true \
    daily-sync