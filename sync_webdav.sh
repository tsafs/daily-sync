#!/bin/bash

# Copyright (c) 2025, Sebastian Fast
# All rights reserved.
# 
# This source code is licensed under the GPL-style license found in the
# LICENSE file in the root directory of this source tree. 

set -e

# Source environment variables
if [ -f /etc/environment ]; then
    . /etc/environment
fi

# Variables
DATA_DIR="/data"               # Directory containing unencrypted files
WEBDAV_TARGET_DIR="${WEBDAV_TARGET_DIR:-/data}" # Base target directory on WebDAV
USE_ENCRYPTION="${USE_ENCRYPTION:-true}"
RETAIN_BACKUPS="${RETAIN_BACKUPS:-1}" # Default to retaining 1 backup
CHUNK_SIZE_MB="${CHUNK_SIZE_MB:-0}" # Max chunk size from env var

# Calculate volume size for 7z, subtracting 10MB for safety
# Ensure volume size is at least 1MB
VOLUME_ARG=""
if [[ "$CHUNK_SIZE_MB" -gt 10 ]]; then
    # Subtract 10MB for safety
    VOLUME_SIZE_MB=$((CHUNK_SIZE_MB - 10))
    if [[ "$VOLUME_SIZE_MB" -lt 1 ]]; then
        VOLUME_SIZE_MB=1 # Ensure at least 1MB volume size
    fi
    VOLUME_ARG="-v${VOLUME_SIZE_MB}m"
    echo "Using volume size: ${VOLUME_SIZE_MB}MB"
else
    echo "Chunk size not specified or too small, creating single archive."
fi

# Configure naming and backup directory based on encryption setting and timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR_NAME="backup_${TIMESTAMP}"
WEBDAV_BACKUP_PATH="${WEBDAV_TARGET_DIR}/${BACKUP_DIR_NAME}" # Full path for this backup

if [[ "$USE_ENCRYPTION" == "true" ]]; then
    # Base name for the archive parts - 7z will add .zip.001, .zip.002 etc.
    ARCHIVE_BASE_NAME="/tmp/encrypted_data_${TIMESTAMP}"
    ARCHIVE_EXT=".zip" # 7z uses .zip.001, .zip.002 etc. for zip volumes
else
    ARCHIVE_BASE_NAME="/tmp/data_${TIMESTAMP}"
    ARCHIVE_EXT=".zip"
fi
# The first file created by 7z when using volumes with .zip
FIRST_VOLUME_FILE="${ARCHIVE_BASE_NAME}${ARCHIVE_EXT}.001"

# Configure rclone remote
RCLONE_REMOTE="webdav"
RCLONE_CONFIG_FILE="/tmp/rclone.conf"
RCLONE_PASSWORD=$(echo "$WEBDAV_PASSWORD" | rclone obscure -)

# Create rclone config file
cat <<EOF > "$RCLONE_CONFIG_FILE"
[${RCLONE_REMOTE}]
type = webdav
url = ${WEBDAV_URL}
vendor = other
user = ${WEBDAV_USERNAME}
pass = ${RCLONE_PASSWORD}
EOF

# Create a temporary directory for processing
TEMP_DIR=$(mktemp -d)
# SPLIT_DIR is no longer needed

# Copy the data directory to the temporary directory
echo "Copying data directory to temporary location..."
cp -r "$DATA_DIR" "$TEMP_DIR/data"

# Ensure proper permissions for the copied directory
echo "Setting permissions for the copied directory..."
chmod -R 755 "$TEMP_DIR/data"

# Create multi-volume zip file (with or without encryption)
if [[ "$USE_ENCRYPTION" == "true" ]]; then
    echo "Creating encrypted multi-volume zip file (${VOLUME_SIZE_MB}MB parts)..."
    # Note: 7z uses the base name provided, and appends .zip.001 etc.
    7z a -p"$ENCRYPTION_PASSWORD" "$VOLUME_ARG" "${ARCHIVE_BASE_NAME}${ARCHIVE_EXT}" "$TEMP_DIR/data"
else
    echo "Creating unencrypted multi-volume zip file (${VOLUME_SIZE_MB}MB parts)..."
    7z a "$VOLUME_ARG" "${ARCHIVE_BASE_NAME}${ARCHIVE_EXT}" "$TEMP_DIR/data"
fi

# Ensure proper permissions for the archive volumes
echo "Setting permissions for the archive volumes..."
# Use find to handle cases where no volumes are created (very small data)
find /tmp -maxdepth 1 -name "$(basename ${ARCHIVE_BASE_NAME})${ARCHIVE_EXT}.*" -exec chmod 644 {} \;

# --- Remove the split section ---

# Get the list of volume files
# Use find to correctly handle the glob pattern and potential lack of matches
VOLUME_FILES=($(find /tmp -maxdepth 1 -name "$(basename ${ARCHIVE_BASE_NAME})${ARCHIVE_EXT}.*" -print))
PART_COUNT=${#VOLUME_FILES[@]}
if [[ "$PART_COUNT" -eq 0 ]]; then
    echo "Warning: No volume files found. Check if 7z command was successful and data was present."
    # Decide if you want to exit or continue (e.g., upload an empty manifest?)
    # For now, we'll continue and potentially upload just a manifest
fi
echo "Created $PART_COUNT volumes"

# Create the target backup directory on WebDAV
echo "Creating target directory on WebDAV: $WEBDAV_BACKUP_PATH"
rclone mkdir "$RCLONE_REMOTE:$WEBDAV_BACKUP_PATH" --config "$RCLONE_CONFIG_FILE"

# Upload each volume to the specific backup directory on WebDAV
echo "Uploading volumes to $WEBDAV_BACKUP_PATH ..."
for volume in "${VOLUME_FILES[@]}"; do
    if [ -f "$volume" ]; then # Check if it's a file
        volume_name=$(basename "$volume")
        echo "Uploading $volume_name..."
        rclone copy "$volume" "$RCLONE_REMOTE:$WEBDAV_BACKUP_PATH" --config "$RCLONE_CONFIG_FILE"
    fi
done

# Clean up old backups
echo "Cleaning up old backups, retaining the latest $RETAIN_BACKUPS..."

# List directories matching the backup pattern, sort by name (timestamp), keep the newest
dirs_to_delete=$(rclone lsf --config "$RCLONE_CONFIG_FILE" "$RCLONE_REMOTE:$WEBDAV_TARGET_DIR" --dirs-only | \
    grep -E '^backup_[0-9]{8}_[0-9]{6}/$' | \
    sort -r | \
    tail -n +$((RETAIN_BACKUPS + 1)))

if [ -n "$dirs_to_delete" ]; then
    echo "Deleting old backup directories:"
    echo "$dirs_to_delete"
    echo "$dirs_to_delete" | while IFS= read -r dir_to_delete; do
        # Ensure trailing slash is handled if present
        dir_path="${WEBDAV_TARGET_DIR}/${dir_to_delete%/}" 
        echo "Deleting directory: $dir_path"
        rclone purge --config "$RCLONE_CONFIG_FILE" "$RCLONE_REMOTE:$dir_path"
    done
else
    echo "No old backup directories to delete."
fi


# Clean up temporary files
echo "Cleaning up temporary files..."
# Remove the temporary data directory, the local manifest, and rclone config
rm -rf "$TEMP_DIR" "$RCLONE_CONFIG_FILE"
# Remove local volumes carefully using find
find /tmp -maxdepth 1 -name "$(basename ${ARCHIVE_BASE_NAME})${ARCHIVE_EXT}.*" -delete

echo "Sync complete."