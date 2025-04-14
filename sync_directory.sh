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
TARGET_DIRECTORY="/target" # Target directory inside the container
USE_ENCRYPTION="${USE_ENCRYPTION:-true}"

# Ensure target directory exists
mkdir -p "$TARGET_DIRECTORY"

if [[ "$USE_ENCRYPTION" == "true" ]]; then
    ZIP_FILE="/tmp/encrypted_data_$(date +%Y%m%d_%H%M%S).zip"  # Temporary zip file for encrypted data
else
    ZIP_FILE="/tmp/data_$(date +%Y%m%d_%H%M%S).zip"  # Temporary zip file for unencrypted data
fi

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

    # Copy the zip file to the target directory
    echo "Copying encrypted zip file to target directory: $TARGET_DIRECTORY"
    cp "$ZIP_FILE" "$TARGET_DIRECTORY/"

    # Get ownership of the target directory
    TARGET_OWNER=$(stat -c '%u:%g' "$TARGET_DIRECTORY")
    echo "Detected target directory ownership: $TARGET_OWNER"

    # Change ownership of the copied file to match the target directory
    echo "Changing ownership of $TARGET_DIRECTORY/$(basename $ZIP_FILE) to $TARGET_OWNER"
    chown "$TARGET_OWNER" "$TARGET_DIRECTORY/$(basename $ZIP_FILE)"

    # Clean up
    rm -rf "$TEMP_DIR" "$ZIP_FILE"

    echo "Directory sync complete (encrypted)."
else
    # Create an unencrypted zip file
    echo "Creating unencrypted zip file..."
    7z a "$ZIP_FILE" "$TEMP_DIR/data"

    # Ensure proper permissions for the zip file
    echo "Setting permissions for the unencrypted zip file..."
    chmod 644 "$ZIP_FILE"

    # Copy the zip file to the target directory
    echo "Copying unencrypted zip file to target directory: $TARGET_DIRECTORY"
    cp "$ZIP_FILE" "$TARGET_DIRECTORY/"

    # Get ownership of the target directory
    TARGET_OWNER=$(stat -c '%u:%g' "$TARGET_DIRECTORY")
    echo "Detected target directory ownership: $TARGET_OWNER"

    # Change ownership of the copied file to match the target directory
    echo "Changing ownership of $TARGET_DIRECTORY/$(basename $ZIP_FILE) to $TARGET_OWNER"
    chown "$TARGET_OWNER" "$TARGET_DIRECTORY/$(basename $ZIP_FILE)"

    # Clean up
    rm -rf "$TEMP_DIR" "$ZIP_FILE"

    echo "Directory sync complete (unencrypted)."
fi
