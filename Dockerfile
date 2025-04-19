# Copyright (c) 2025, Sebastian Fast
# All rights reserved.
# 
# This source code is licensed under the GPL-style license found in the
# LICENSE file in the root directory of this source tree. 

# Use a lightweight base image with bash, 7z, and cron
FROM debian:bullseye-slim

# Install required tools
RUN apt-get update && apt-get install -y \
    p7zip-full \
    rsync \
    cron \
    wget \
    lftp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Install rclone
RUN wget https://downloads.rclone.org/rclone-current-linux-amd64.deb && \
    dpkg -i rclone-current-linux-amd64.deb && \
    rm rclone-current-linux-amd64.deb

# Create necessary directories
RUN mkdir -p /data

# Copy the sync scripts into the container
COPY sync_webdav.sh /usr/local/bin/sync_webdav.sh
COPY sync_directory.sh /usr/local/bin/sync_directory.sh
COPY sync_ftp.sh /usr/local/bin/sync_ftp.sh

# Make the scripts executable
RUN chmod +x /usr/local/bin/sync_webdav.sh
RUN chmod +x /usr/local/bin/sync_directory.sh
RUN chmod +x /usr/local/bin/sync_ftp.sh

# Copy the entrypoint script
COPY entrypoint.sh /usr/local/bin/entrypoint.sh

# Make the entrypoint script executable
RUN chmod +x /usr/local/bin/entrypoint.sh

# Set the entrypoint to the custom script
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]