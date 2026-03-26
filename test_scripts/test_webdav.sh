sudo docker run --rm \
    -v ./test_data/medium:/data:ro \
    -v /etc/localtime:/etc/localtime:ro \
    -v /etc/timezone:/etc/timezone:ro \
    -e SYNC_MODE="webdav" \
    -e WEBDAV_URL="https://nextcloud05.webo.cloud/remote.php/dav/files/sebastian.fast%40posteo.net" \
    -e WEBDAV_USERNAME="sebastian.fast@posteo.net" \
    -e WEBDAV_PASSWORD="'}:5KpI,(DpU)eT9oXH\`" \
    -e WEBDAV_TARGET_DIR="/test" \
    -e CHUNK_SIZE_MB=20 \
    -e USE_ENCRYPTION=false \
    -e ENCRYPTION_PASSWORD="abc" \
    -e RETAIN_BACKUPS=3 \
    -e CRON_TIME="16 13" \
    -e CRON_DAYS="*" \
    -e DEBUG=true \
    daily-sync