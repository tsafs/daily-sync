#!/bin/bash

# Copyright (c) 2025, Sebastian Fast
# All rights reserved.
#
# This source code is licensed under the GPL-style license found in the
# LICENSE file in the root directory of this source tree.

set -e

# Add cleanup function to ensure all temp files are removed
cleanup() {
    local exit_code=$?
    echo "Running cleanup..."
    
    # Remove the temporary directory
    [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"
    
    # Remove any archive files that may have been left behind
    [ -f "$ARCHIVE_FILE" ] && rm -f "$ARCHIVE_FILE"
    
    # Also clean any old temporary files from failed previous runs (older than 1 day)
    find /tmp -maxdepth 1 -name "encrypted_data_*" -o -name "data_*" -type f -mtime +1 -delete
    
    echo "Cleanup complete."
    exit $exit_code
}

# Set trap to ensure cleanup happens even if script fails
trap cleanup EXIT

# Source environment variables
if [ -f /etc/environment ]; then
    . /etc/environment
fi

# Variables
DATA_DIR="/data"           # Directory containing unencrypted files
TARGET_DIRECTORY="/target" # Target directory inside the container
USE_ENCRYPTION="${USE_ENCRYPTION:-true}"
RETAIN_BACKUPS="${RETAIN_BACKUPS:-1}" # Default to retaining 1 backup

# Configure naming based on encryption setting and timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
if [[ "$USE_ENCRYPTION" == "true" ]]; then
    ARCHIVE_BASE_NAME="/tmp/encrypted_data_${TIMESTAMP}"
else
    ARCHIVE_BASE_NAME="/tmp/data_${TIMESTAMP}"
fi
ARCHIVE_EXT=".zip"
ARCHIVE_FILE="${ARCHIVE_BASE_NAME}${ARCHIVE_EXT}"

# Ensure target directory exists
mkdir -p "$TARGET_DIRECTORY"

# Create a temporary directory for processing
TEMP_DIR=$(mktemp -d)

# Copy the data directory to the temporary directory
echo "Copying data directory to temporary location..."
cp -r "$DATA_DIR" "$TEMP_DIR/data"

# Create zip file (with or without encryption)
if [[ "$USE_ENCRYPTION" == "true" ]]; then
    echo "Creating encrypted zip file..."
    7z a -p"$ENCRYPTION_PASSWORD" "$ARCHIVE_FILE" "$TEMP_DIR/data"
else
    echo "Creating unencrypted zip file..."
    7z a "$ARCHIVE_FILE" "$TEMP_DIR/data"
fi

# Copy the zip file to the target directory
echo "Copying zip file to target directory: $TARGET_DIRECTORY"
cp "$ARCHIVE_FILE" "$TARGET_DIRECTORY/"

# Get ownership of the target directory
TARGET_OWNER=$(stat -c '%u:%g' "$TARGET_DIRECTORY")
echo "Detected target directory ownership: $TARGET_OWNER"

# Change ownership of the copied file to match the target directory
TARGET_FILE_PATH="$TARGET_DIRECTORY/$(basename $ARCHIVE_FILE)"
echo "Changing ownership of $TARGET_FILE_PATH to $TARGET_OWNER"
chown "$TARGET_OWNER" "$TARGET_FILE_PATH"

# Clean up old backups
echo "Cleaning up old backups in $TARGET_DIRECTORY, retaining the latest $RETAIN_BACKUPS..."
# List files matching the pattern, sort by time (newest first), skip the ones to retain, get the rest
files_to_delete=$(find "$TARGET_DIRECTORY" -maxdepth 1 -regextype posix-extended -regex "^.*/(encrypted_data_|data_)[0-9]{8}_[0-9]{6}\.zip$" -printf '%f\n' |
    sed -E 's/(encrypted_data_|data_)([0-9]{8}_[0-9]{6})\.zip$/\2 \0/' | # Extract timestamp for sorting
    sort -k1,1r | # Sort by timestamp descending (newest first)
    cut -d' ' -f2- | # Get the original filename back
    tail -n +$((RETAIN_BACKUPS + 1)) | # Skip the newest N backups
    sed "s|^|$TARGET_DIRECTORY/|") # Prepend directory path for deletion

if [ -n "$files_to_delete" ]; then
    echo "Deleting old backups:"
    echo "$files_to_delete"
    echo "$files_to_delete" | xargs -d '\n' rm -- # Use newline as delimiter and ensure rm handles filenames correctly
else
    echo "No old backups to delete."
fi

# Cleanup handled by trap EXIT
echo "Directory sync complete."
