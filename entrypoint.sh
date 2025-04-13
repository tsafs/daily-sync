#!/bin/bash

# Copyright (c) 2025, Sebastian Fast
# All rights reserved.
# 
# This source code is licensed under the GPL-style license found in the
# LICENSE file in the root directory of this source tree. 

set -e

# Default values for cron schedule
CRON_TIME="${CRON_TIME:-0 2}" # Default to 2:00 AM
CRON_DAYS="${CRON_DAYS:-*}"  # Default to every day
USE_ENCRYPTION="${USE_ENCRYPTION:-true}"
DEBUG="${DEBUG:-false}"

# Split CRON_TIME into minute and hour
CRON_MINUTE=$(echo "$CRON_TIME" | awk '{print $1}')
CRON_HOUR=$(echo "$CRON_TIME" | awk '{print $2}')

# Validate CRON_MINUTE and CRON_HOUR separately
if ! [[ "$CRON_MINUTE" =~ ^([0-5]?[0-9]|\*)$ ]]; then
    echo "Error: CRON_MINUTE must be a valid minute (0-59) or '*'."
    exit 1
fi

if ! [[ "$CRON_HOUR" =~ ^([0-2]?[0-9]|\*)$ ]]; then
    echo "Error: CRON_HOUR must be a valid hour (0-23) or '*'."
    exit 1
fi

# Ensure required environment variables are set
if [[ -z "$WEBDAV_URL" || -z "$WEBDAV_USERNAME" || -z "$WEBDAV_PASSWORD" ]]; then
    echo "Error: WEBDAV_URL, WEBDAV_USERNAME, and WEBDAV_PASSWORD must be set."
    exit 1
fi

# Ensure the gocryptfs password is set only if USE_ENCRYPTION is true
if [[ "$USE_ENCRYPTION" == "true" && -z "$ENCRYPTION_PASSWORD" ]]; then
    echo "Error: ENCRYPTION_PASSWORD must be set when USE_ENCRYPTION is true."
    exit 1
fi

# Debug mode: Skip cron configuration and directly run the sync script
if [[ "$DEBUG" == "true" ]]; then
    echo "Debug mode enabled. Skipping cron configuration."
    /usr/local/bin/sync.sh
    exit 0
fi

# Function to escape special characters for environment variables
escape_env_var() {
    echo \'$(echo $1 | sed -e "s/'/'\\\\''/g")\'
}

# Exporting environment variables for cron
echo "Exporting environment variables for cron..."
{
    echo "WEBDAV_URL=$(escape_env_var "$WEBDAV_URL")"
    echo "WEBDAV_USERNAME=$(escape_env_var "$WEBDAV_USERNAME")"
    echo "WEBDAV_PASSWORD=$(escape_env_var "$WEBDAV_PASSWORD")"
    echo "WEBDAV_TARGET_DIR=$(escape_env_var "${WEBDAV_TARGET_DIR:-/data}")"
    echo "USE_ENCRYPTION=$(escape_env_var "${USE_ENCRYPTION:-true}")"
    echo "ENCRYPTION_PASSWORD=$(escape_env_var "$ENCRYPTION_PASSWORD")"
} > /etc/environment
cat /etc/environment

# Generate the cron job with embedded environment variables
echo "Generating cron job with schedule: $CRON_MINUTE $CRON_HOUR * * $CRON_DAYS"
echo "$CRON_MINUTE $CRON_HOUR * * $CRON_DAYS /usr/local/bin/sync.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/webdav-sync

# Set permissions for the cron job file
chmod 0644 /etc/cron.d/webdav-sync

# Apply the cron job
crontab /etc/cron.d/webdav-sync

# Set the timezone if specified
if [ -n "$TIMEZONE" ]; then
    echo "Setting timezone to $TIMEZONE"
    ln -sf /usr/share/zoneinfo/$TIMEZONE /etc/localtime
    echo "$TIMEZONE" > /etc/timezone
    dpkg-reconfigure -f noninteractive tzdata
fi

# Start cron service
service cron start

# Ensure the cron log file exists
touch /var/log/cron.log

# Keep the container running
tail -f /var/log/cron.log