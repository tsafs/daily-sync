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

# Use lftp to create directory, upload the file(s), and manage retention
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

# Add the remaining commands for retention and quit
# List directories matching the pattern, sort by time (implicitly newest first with glob), skip the newest ones, and remove the rest.
LFTP_COMMANDS+=$(cat <<EOF

cd ..
cls -1 --sort=name backup_* | tac | sed -e 's#/##g' | tail -n +$(($RETAIN_BACKUPS + 1)) | xargs -r rmdir
quit
EOF
)

# Execute the lftp commands
echo "Executing LFTP commands..."
# Optional: Uncomment below to debug the generated lftp script
# echo "$LFTP_COMMANDS"
echo "$LFTP_COMMANDS" | lftp

# Check the exit status of lftp
if [ $? -eq 0 ]; then
    echo "FTP sync completed successfully."
else
    echo "Error: FTP sync failed."
    # Clean up temporary files even on failure
    echo "Cleaning up temporary files..."
    rm -rf "$TEMP_DIR"
    # Remove local volumes carefully using find
    find /tmp -maxdepth 1 -name "${LOCAL_ARCHIVE_BASENAME}*" -delete
    exit 1
fi

# Clean up temporary files on success
echo "Cleaning up temporary files..."
rm -rf "$TEMP_DIR"
# Remove local volumes carefully using find
find /tmp -maxdepth 1 -name "${LOCAL_ARCHIVE_BASENAME}*" -delete

exit 0
