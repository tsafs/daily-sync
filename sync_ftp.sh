#!/bin/bash
set -e

# Source environment variables
if [ -f /etc/environment ]; then
    . /etc/environment
fi

# Variables
DATA_DIR="/data"               # Directory containing unencrypted files
FTP_HOST="${FTP_HOST}"
FTP_USER="${FTP_USER}"
FTP_PASSWORD="${FTP_PASSWORD}"
FTP_TARGET_DIR="${FTP_TARGET_DIR:-/}" # Base target directory on FTP, default to root
USE_ENCRYPTION="${USE_ENCRYPTION:-true}"
RETAIN_BACKUPS="${RETAIN_BACKUPS:-1}" # Default to keeping 1 backup
CHUNK_SIZE_MB="${CHUNK_SIZE_MB:-0}" # Max chunk size from env var, 0 means no splitting

# Validate required variables
if [ -z "$FTP_HOST" ] || [ -z "$FTP_USER" ] || [ -z "$FTP_PASSWORD" ]; then
    echo "Error: FTP_HOST, FTP_USER, and FTP_PASSWORD must be set for FTP sync mode."
    exit 1
fi

# Calculate volume size for 7z if CHUNK_SIZE_MB is set and greater than 10
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
FTP_BACKUP_PATH="${FTP_TARGET_DIR}/${BACKUP_DIR_NAME}" # Full path for this backup on FTP

if [[ "$USE_ENCRYPTION" == "true" ]]; then
    ARCHIVE_BASE_NAME="/tmp/encrypted_data_${TIMESTAMP}"
    ARCHIVE_EXT=".zip"
else
    ARCHIVE_BASE_NAME="/tmp/data_${TIMESTAMP}"
    ARCHIVE_EXT=".zip"
fi
LOCAL_ARCHIVE_PATH="${ARCHIVE_BASE_NAME}${ARCHIVE_EXT}"
# Base name for finding volumes later
LOCAL_ARCHIVE_BASENAME=$(basename "$LOCAL_ARCHIVE_PATH")

# Create a temporary directory for processing
TEMP_DIR=$(mktemp -d)

# Copy the data directory to the temporary directory
echo "Copying data directory to temporary location..."
cp -r "$DATA_DIR" "$TEMP_DIR/data"

# Ensure proper permissions for the copied directory
echo "Setting permissions for the copied directory..."
chmod -R 755 "$TEMP_DIR/data"

# Create zip file (with or without encryption, potentially multi-volume)
if [[ "$USE_ENCRYPTION" == "true" ]]; then
    echo "Creating encrypted zip file... ${VOLUME_ARG}"
    7z a -p"$ENCRYPTION_PASSWORD" "$VOLUME_ARG" "$LOCAL_ARCHIVE_PATH" "$TEMP_DIR/data"
else
    echo "Creating unencrypted zip file... ${VOLUME_ARG}"
    7z a "$VOLUME_ARG" "$LOCAL_ARCHIVE_PATH" "$TEMP_DIR/data"
fi

# Ensure proper permissions for the archive volumes
echo "Setting permissions for the archive volumes..."
# Use find to handle cases where no volumes are created (single file or small data)
find /tmp -maxdepth 1 -name "${LOCAL_ARCHIVE_BASENAME}*" -exec chmod 644 {} \;

# Get the list of volume files
VOLUME_FILES=($(find /tmp -maxdepth 1 -name "${LOCAL_ARCHIVE_BASENAME}*" -print))
PART_COUNT=${#VOLUME_FILES[@]}
if [[ "$PART_COUNT" -eq 0 ]]; then
    echo "Error: No archive files found after 7z command. Check if 7z command was successful and data was present."
    rm -rf "$TEMP_DIR"
    exit 1
fi
echo "Created $PART_COUNT archive part(s)"

echo "Starting FTP sync..."
echo "Host: $FTP_HOST"
echo "Target Base Directory: $FTP_TARGET_DIR"
echo "Backup Directory: $BACKUP_DIR_NAME"
echo "Files to upload: ${LOCAL_ARCHIVE_BASENAME}*"
echo "Retain backups: $RETAIN_BACKUPS"

# First: Upload the new backup
LFTP_COMMANDS=$(cat <<EOF
set cmd:fail-exit no;
set ftp:ssl-allow no;
open -u "$FTP_USER","$FTP_PASSWORD" "$FTP_HOST"
mkdir -pf "$FTP_TARGET_DIR"
cd "$FTP_TARGET_DIR"
mkdir -pf "$BACKUP_DIR_NAME"
cd "$BACKUP_DIR_NAME"
lcd /tmp
EOF
)

# Add put commands for each volume file found earlier
for vol_file in "${VOLUME_FILES[@]}"; do
    LFTP_COMMANDS+=$(printf "\nput '%s'" "$vol_file")
done

LFTP_COMMANDS+=$(cat <<EOF

quit
EOF
)

# Execute the lftp commands for upload
echo "Executing LFTP upload commands..."
echo "$LFTP_COMMANDS" | lftp

# Check if upload was successful
if [ $? -ne 0 ]; then
    echo "Error: FTP upload failed."
    # Clean up temporary files on failure
    echo "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
    find /tmp -maxdepth 1 -name "${LOCAL_ARCHIVE_BASENAME}*" -delete
    exit 1
fi

echo "Upload successful. Now retrieving backup directory list..."

# Second: Get list of backup directories
BACKUP_LIST=$(lftp -c "
set ftp:ssl-allow no;
open -u \"$FTP_USER\",\"$FTP_PASSWORD\" \"$FTP_HOST\";
cd \"$FTP_TARGET_DIR\";
cls -1 --sort=name;
" 2>&1 | grep "^backup_[0-9]\{8\}_[0-9]\{6\}" || true)

echo "Backup directories retrieved:"
echo "$BACKUP_LIST"

# Third: Process the list and determine which ones to delete
echo "Processing backup list for retention..."
BACKUP_COUNT=$(echo "$BACKUP_LIST" | wc -l)
echo "Found $BACKUP_COUNT backups"

if [ $BACKUP_COUNT -gt $RETAIN_BACKUPS ]; then
    # Calculate how many to delete
    DELETE_COUNT=$((BACKUP_COUNT - RETAIN_BACKUPS))
    echo "Will delete $DELETE_COUNT old backups (keeping $RETAIN_BACKUPS most recent)"
    
    # Get list of directories to delete (oldest first)
    DIRS_TO_DELETE=$(echo "$BACKUP_LIST" | head -n $DELETE_COUNT)
    
    # Fourth: Execute deletion if needed
    if [ -n "$DIRS_TO_DELETE" ]; then
        echo "Removing old backups..."
        
        # Build the deletion commands
        DEL_COMMANDS="set ftp:ssl-allow no;
open -u \"$FTP_USER\",\"$FTP_PASSWORD\" \"$FTP_HOST\";
cd \"$FTP_TARGET_DIR\";"
        
        # Add each directory to the delete commands
        while read -r dir; do
            DEL_COMMANDS+="
echo \"Deleting $dir\";
rm -rf \"$dir\";"
        done <<< "$DIRS_TO_DELETE"
        
        # Execute the deletion
        echo "$DEL_COMMANDS" | lftp
        
        if [ $? -eq 0 ]; then
            echo "Old backups successfully removed"
        else
            echo "Warning: Failed to remove some old backups"
        fi
    fi
else
    echo "No old backups need to be deleted (keeping $RETAIN_BACKUPS)"
fi

echo "FTP sync completed successfully."