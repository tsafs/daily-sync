sudo docker run --rm \
    -v ./test_data/small:/data:ro \
    -v ./test_target:/target \
    -v /etc/localtime:/etc/localtime:ro \
    -v /etc/timezone:/etc/timezone:ro \
    -e SYNC_MODE="directory" \
    -e USE_ENCRYPTION=true \
    -e ENCRYPTION_PASSWORD="abc" \
    -e RETAIN_BACKUPS=3 \
    -e CRON_TIME="26 14" \
    -e CRON_DAYS="*" \
    -e DEBUG=false \
    daily-sync