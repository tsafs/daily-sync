#!/bin/bash

# Copyright (c) 2025, Sebastian Fast
# All rights reserved.
# 
# This source code is licensed under the GPL-style license found in the
# LICENSE file in the root directory of this source tree. 

set -e

# Default values
CRON_TIME="${CRON_TIME:-0 2}" # Default to 2:00 AM
CRON_DAYS="${CRON_DAYS:-*}"  # Default to every day
USE_ENCRYPTION="${USE_ENCRYPTION:-true}"
DEBUG="${DEBUG:-false}"
SYNC_MODE="${SYNC_MODE:-webdav}" # Default sync mode is webdav
RETAIN_BACKUPS="${RETAIN_BACKUPS:-1}" # Default number of backups to retain
FTP_TARGET_DIR="${FTP_TARGET_DIR:-/}" # Default FTP target directory

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

# Validate RETAIN_BACKUPS
if ! [[ "$RETAIN_BACKUPS" =~ ^[1-9][0-9]*$ ]]; then
    echo "Error: RETAIN_BACKUPS must be a positive integer greater than 0."
    exit 1
fi

# Ensure required environment variables are set based on SYNC_MODE
if [[ "$SYNC_MODE" == "webdav" ]]; then
    if [[ -z "$WEBDAV_URL" || -z "$WEBDAV_USERNAME" || -z "$WEBDAV_PASSWORD" ]]; then
        echo "Error: WEBDAV_URL, WEBDAV_USERNAME, and WEBDAV_PASSWORD must be set for webdav sync mode."
        exit 1
    fi
    SYNC_SCRIPT="/usr/local/bin/sync_webdav.sh"
elif [[ "$SYNC_MODE" == "directory" ]]; then
    # No specific env vars needed for directory mode anymore
    SYNC_SCRIPT="/usr/local/bin/sync_directory.sh"
elif [[ "$SYNC_MODE" == "ftp" ]]; then
    if [[ -z "$FTP_HOST" || -z "$FTP_USER" || -z "$FTP_PASSWORD" ]]; then
        echo "Error: FTP_HOST, FTP_USER, and FTP_PASSWORD must be set for ftp sync mode."
        exit 1
    fi
    SYNC_SCRIPT="/usr/local/bin/sync_ftp.sh"
else
    echo "Error: Invalid SYNC_MODE specified. Must be 'webdav', 'directory', or 'ftp'."
    exit 1
fi

# Ensure the encryption password is set only if USE_ENCRYPTION is true
if [[ "$USE_ENCRYPTION" == "true" && -z "$ENCRYPTION_PASSWORD" ]]; then
    echo "Error: ENCRYPTION_PASSWORD must be set when USE_ENCRYPTION is true."
    exit 1
fi

# Debug mode: Skip cron configuration and directly run the appropriate sync script
if [[ "$DEBUG" == "true" ]]; then
    echo "Debug mode enabled. Skipping cron configuration."
    echo "Running sync script: $SYNC_SCRIPT"
    $SYNC_SCRIPT
    exit 0
fi

# Function to escape special characters for environment variables
escape_env_var() {
    echo \'$(echo $1 | sed -e "s/'/'\\\\''/g")\'
}

# Exporting environment variables for cron based on SYNC_MODE
{
    echo "USE_ENCRYPTION=$(escape_env_var "${USE_ENCRYPTION:-true}")"
    echo "ENCRYPTION_PASSWORD=$(escape_env_var "$ENCRYPTION_PASSWORD")" # Needed for all modes if encryption is on
    echo "RETAIN_BACKUPS=$(escape_env_var "$RETAIN_BACKUPS")" # Export retain count
    if [[ "$SYNC_MODE" == "webdav" ]]; then
        echo "WEBDAV_URL=$(escape_env_var "$WEBDAV_URL")"
        echo "WEBDAV_USERNAME=$(escape_env_var "$WEBDAV_USERNAME")"
        echo "WEBDAV_PASSWORD=$(escape_env_var "$WEBDAV_PASSWORD")"
        echo "WEBDAV_TARGET_DIR=$(escape_env_var "${WEBDAV_TARGET_DIR:-/data}")"
    elif [[ "$SYNC_MODE" == "directory" ]]; then
        # No specific env vars to export for directory mode
        :
    elif [[ "$SYNC_MODE" == "ftp" ]]; then
        echo "FTP_HOST=$(escape_env_var "$FTP_HOST")"
        echo "FTP_USER=$(escape_env_var "$FTP_USER")"
        echo "FTP_PASSWORD=$(escape_env_var "$FTP_PASSWORD")"
        echo "FTP_TARGET_DIR=$(escape_env_var "$FTP_TARGET_DIR")"
    fi
} > /etc/environment

# Generate the cron job with the correct sync script
echo "Generating cron job with schedule: $CRON_MINUTE $CRON_HOUR * * $CRON_DAYS"
if [[ "$SYNC_MODE" == "webdav" ]]; then
    echo "$CRON_MINUTE $CRON_HOUR * * $CRON_DAYS /usr/local/bin/sync_webdav.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/daily-sync
elif [[ "$SYNC_MODE" == "directory" ]]; then
    echo "$CRON_MINUTE $CRON_HOUR * * $CRON_DAYS /usr/local/bin/sync_directory.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/daily-sync
elif [[ "$SYNC_MODE" == "ftp" ]]; then
    echo "$CRON_MINUTE $CRON_HOUR * * $CRON_DAYS /usr/local/bin/sync_ftp.sh >> /var/log/cron.log 2>&1" > /etc/cron.d/daily-sync
fi

# Set permissions for the cron job file
chmod 0644 /etc/cron.d/daily-sync

# Apply the cron job
crontab /etc/cron.d/daily-sync

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