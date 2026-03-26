sudo docker run --rm \
    -v ./test_data/small:/data:ro \
    -v /etc/localtime:/etc/localtime:ro \
    -v /etc/timezone:/etc/timezone:ro \
    -e SYNC_MODE="ftp" \
    -e FTP_HOST="192.168.137.1" \
    -e FTP_USER="sondlgnas" \
    -e FTP_PASSWORD="ziznax-cyqgo2-xEnqun" \
    -e FTP_TARGET_DIR="/test" \
    -e CHUNK_SIZE_MB=20 \
    -e USE_ENCRYPTION=false \
    -e ENCRYPTION_PASSWORD="abc" \
    -e RETAIN_BACKUPS=3 \
    -e CRON_TIME="11 15" \
    -e CRON_DAYS="*" \
    -e DEBUG=true \
    daily-sync