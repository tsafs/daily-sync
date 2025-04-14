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
WEBDAV_TARGET_DIR="${WEBDAV_TARGET_DIR:-/data}" # Default to /data if not set
USE_ENCRYPTION="${USE_ENCRYPTION:-true}"

if [[ "$USE_ENCRYPTION" == "true" ]]; then
    ZIP_FILE="/tmp/encrypted_data_$(date +%Y%m%d_%H%M%S).zip"  # Temporary zip file for encrypted data
else
    ZIP_FILE="/tmp/data_$(date +%Y%m%d_%H%M%S).zip"  # Temporary zip file for unencrypted data
fi

# Configure rclone remote
RCLONE_REMOTE="webdav"
RCLONE_CONFIG_FILE="/tmp/rclone.conf"
RCLONE_PASSWORD=$(echo "$WEBDAV_PASSWORD" | rclone obscure -)

echo $WEBDAV_URL
echo $WEBDAV_USERNAME
echo $RCLONE_PASSWORD
echo $RCLONE_REMOTE
echo $RCLONE_CONFIG_FILE

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

# Copy the data directory to the temporary directory
echo "Copying data directory to temporary location..."
cp -r "$DATA_DIR" "$TEMP_DIR/data"

# Ensure proper permissions for the copied directory
echo "Setting permissions for the copied directory..."
chmod -R 755 "$TEMP_DIR/data"

if [[ "$USE_ENCRYPTION" == "true" ]]; then
    # Create a password-protected zip file
    echo "Creating encrypted zip file..."
    7z a -p"$ENCRYPTION_PASSWORD" "$ZIP_FILE" "$TEMP_DIR/data"

    # Ensure proper permissions for the zip file
    echo "Setting permissions for the encrypted zip file..."
    chmod 644 "$ZIP_FILE"

    # Upload the zip file to WebDAV
    echo "Uploading encrypted zip file to WebDAV..."
    rclone copy "$ZIP_FILE" "$RCLONE_REMOTE:$WEBDAV_TARGET_DIR" --config "$RCLONE_CONFIG_FILE"

    # Clean up
    rm -rf "$TEMP_DIR" "$ZIP_FILE" "$RCLONE_CONFIG_FILE"

    echo "Sync complete."
else
    # Create an unencrypted zip file
    echo "Creating unencrypted zip file..."
    7z a "$ZIP_FILE" "$TEMP_DIR/data"

    # Ensure proper permissions for the zip file
    echo "Setting permissions for the unencrypted zip file..."
    chmod 644 "$ZIP_FILE"

    # Upload the zip file to WebDAV
    echo "Uploading unencrypted zip file to WebDAV..."
    rclone copy "$ZIP_FILE" "$RCLONE_REMOTE:$WEBDAV_TARGET_DIR" --config "$RCLONE_CONFIG_FILE"

    # Clean up
    rm -rf "$TEMP_DIR" "$ZIP_FILE" "$RCLONE_CONFIG_FILE"

    echo "Sync complete."
fi