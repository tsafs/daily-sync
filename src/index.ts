import { createLogger } from './services/logger.js';

// Create the root logger — all child loggers inherit redaction rules
const log = createLogger({
    level: process.env.LOG_LEVEL ?? 'info',
});

log.info('daily-sync starting...');
