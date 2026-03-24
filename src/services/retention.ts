import type { BackupProvider } from '../providers/provider.js';
import { type Logger, createSilentLogger } from './logger.js';

/**
 * GFS (Grandfather-Father-Son) retention configuration.
 */
export interface GfsConfig {
    /** Keep all backups from the last N days (Son / Daily tier) */
    daily: number;
    /** Keep one backup per week for the last N weeks (Father / Weekly tier) */
    weekly: number;
    /** Keep one backup per month for the last N months (Grandfather / Monthly tier) */
    monthly: number;
}

/**
 * A parsed backup entry with its original directory name and extracted timestamp.
 */
export interface BackupEntry {
    /** Original directory name (e.g. "backup_20260315_020000") */
    name: string;
    /** Parsed timestamp from the directory name */
    timestamp: Date;
}

/**
 * Result of a retention evaluation — which backups to keep and which to delete.
 */
export interface RetentionResult {
    /** Backups that should be kept (with the tier(s) that justify keeping them) */
    keep: Array<{ entry: BackupEntry; tiers: string[] }>;
    /** Backups that should be deleted */
    delete: BackupEntry[];
}

/**
 * The expected backup directory name format: backup_YYYYMMDD_HHMMSS
 */
const BACKUP_DIR_PATTERN = /^backup_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;

/**
 * Parse a backup directory name into a BackupEntry.
 * Returns null if the name doesn't match the expected format.
 */
export function parseBackupName(name: string): BackupEntry | null {
    const match = name.match(BACKUP_DIR_PATTERN);
    if (!match) {
        return null;
    }

    const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minuteStr, 10);
    const second = parseInt(secondStr, 10);

    // Validate ranges before constructing the Date
    // (JS Date silently rolls over e.g. month 13 → next year)
    if (month < 1 || month > 12 || day < 1 || day > 31 ||
        hour > 23 || minute > 59 || second > 59) {
        return null;
    }

    const timestamp = new Date(year, month - 1, day, hour, minute, second);

    // Verify the date didn't roll over (e.g. Feb 30 → Mar 2)
    if (timestamp.getFullYear() !== year ||
        timestamp.getMonth() !== month - 1 ||
        timestamp.getDate() !== day) {
        return null;
    }

    return { name, timestamp };
}

/**
 * Get the start of the day (midnight) for a given date.
 */
function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Get the start of the ISO week (Monday) for a given date.
 */
function startOfWeek(date: Date): Date {
    const d = startOfDay(date);
    const dayOfWeek = d.getDay();
    // JS: Sunday=0, Monday=1, ..., Saturday=6
    // ISO: Monday is first day of week
    const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    d.setDate(d.getDate() - diff);
    return d;
}

/**
 * Get the start of the month for a given date.
 */
function startOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Evaluate which backups to keep and which to delete based on GFS retention policy.
 *
 * Algorithm:
 * 1. All backups from the last `daily` days → keep (daily tier)
 * 2. For each of the last `weekly` weeks, keep the oldest backup from that week
 * 3. For each of the last `monthly` months, keep the oldest backup from that month
 * 4. A backup can satisfy multiple tiers — it's a union of keep sets
 * 5. Everything not in the keep set → delete
 *
 * @param backups - All parsed backup entries
 * @param config - GFS retention configuration
 * @param now - Reference time for "now" (defaults to current time, injectable for testing)
 */
export function evaluateRetention(
    backups: BackupEntry[],
    config: GfsConfig,
    now: Date = new Date(),
): RetentionResult {
    if (backups.length === 0) {
        return { keep: [], delete: [] };
    }

    // Map from backup name → set of tier labels that justify keeping it
    const keepReasons = new Map<string, Set<string>>();

    function markKeep(entry: BackupEntry, tier: string): void {
        const existing = keepReasons.get(entry.name);
        if (existing) {
            existing.add(tier);
        } else {
            keepReasons.set(entry.name, new Set([tier]));
        }
    }

    // --- Daily tier: keep all backups from the last N days ---
    const dailyCutoff = startOfDay(now);
    dailyCutoff.setDate(dailyCutoff.getDate() - config.daily + 1);

    for (const entry of backups) {
        if (entry.timestamp >= dailyCutoff) {
            markKeep(entry, 'daily');
        }
    }

    // --- Weekly tier: keep the oldest backup from each of the last N weeks ---
    if (config.weekly > 0) {
        const currentWeekStart = startOfWeek(now);

        for (let i = 0; i < config.weekly; i++) {
            const weekStart = new Date(currentWeekStart);
            weekStart.setDate(weekStart.getDate() - i * 7);

            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);

            // Find all backups in this week
            const weekBackups = backups.filter(
                (b) => b.timestamp >= weekStart && b.timestamp < weekEnd,
            );

            if (weekBackups.length > 0) {
                // Keep the oldest backup in this week (closest to start-of-week)
                const oldest = weekBackups.reduce((a, b) =>
                    a.timestamp <= b.timestamp ? a : b,
                );
                markKeep(oldest, 'weekly');
            }
        }
    }

    // --- Monthly tier: keep the oldest backup from each of the last N months ---
    if (config.monthly > 0) {
        const currentMonthStart = startOfMonth(now);

        for (let i = 0; i < config.monthly; i++) {
            const monthStart = new Date(
                currentMonthStart.getFullYear(),
                currentMonthStart.getMonth() - i,
                1,
            );

            const monthEnd = new Date(
                monthStart.getFullYear(),
                monthStart.getMonth() + 1,
                1,
            );

            // Find all backups in this month
            const monthBackups = backups.filter(
                (b) => b.timestamp >= monthStart && b.timestamp < monthEnd,
            );

            if (monthBackups.length > 0) {
                // Keep the oldest backup in this month
                const oldest = monthBackups.reduce((a, b) =>
                    a.timestamp <= b.timestamp ? a : b,
                );
                markKeep(oldest, 'monthly');
            }
        }
    }

    // --- Build result ---
    const keep: RetentionResult['keep'] = [];
    const toDelete: BackupEntry[] = [];

    for (const entry of backups) {
        const tiers = keepReasons.get(entry.name);
        if (tiers) {
            keep.push({ entry, tiers: [...tiers] });
        } else {
            toDelete.push(entry);
        }
    }

    return { keep, delete: toDelete };
}


/**
 * Service that applies GFS retention policy to backups stored via a provider.
 *
 * Given a provider and remote path, it:
 * 1. Lists all remote backup directories (format: backup_YYYYMMDD_HHMMSS/)
 * 2. Parses timestamps from directory names
 * 3. Evaluates which backups to keep using the GFS policy
 * 4. Deletes everything not in the keep set
 */
export class RetentionService {
    private readonly log: Logger;

    constructor(
        private readonly config: GfsConfig,
        logger?: Logger,
    ) {
        this.log = (logger ?? createSilentLogger()).child({ service: 'retention' });
    }

    /**
     * List and parse all backup directories at the given remote path.
     * Non-matching entries (files, directories with wrong naming) are ignored.
     */
    async listBackups(provider: BackupProvider, remotePath: string): Promise<BackupEntry[]> {
        this.log.debug({ remotePath }, 'Listing remote backup directories');
        const entries = await provider.list(remotePath);
        const backups: BackupEntry[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory) {
                continue;
            }

            const parsed = parseBackupName(entry.name);
            if (parsed) {
                backups.push(parsed);
            }
        }

        // Sort oldest first
        backups.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        this.log.debug({ count: backups.length }, 'Found backup directories');
        return backups;
    }

    /**
     * Evaluate the retention policy against the current backups.
     * Does not modify anything — pure computation.
     */
    evaluate(backups: BackupEntry[], now?: Date): RetentionResult {
        return evaluateRetention(backups, this.config, now);
    }

    /**
     * Apply the GFS retention policy: list backups, evaluate, and delete expired ones.
     *
     * @param provider - The backup provider to list/delete from
     * @param remotePath - The remote directory containing backup_* subdirectories
     * @param now - Reference time (injectable for testing)
     * @returns The retention result showing what was kept and deleted
     */
    async apply(
        provider: BackupProvider,
        remotePath: string,
        now?: Date,
    ): Promise<RetentionResult> {
        this.log.info(
            { remotePath, daily: this.config.daily, weekly: this.config.weekly, monthly: this.config.monthly },
            'Applying GFS retention policy',
        );

        const backups = await this.listBackups(provider, remotePath);
        const result = this.evaluate(backups, now);

        this.log.info(
            {
                totalBackups: backups.length,
                keeping: result.keep.length,
                deleting: result.delete.length,
            },
            'Retention evaluation complete',
        );

        for (const kept of result.keep) {
            this.log.debug(
                { backup: kept.entry.name, tiers: kept.tiers },
                'Keeping backup',
            );
        }

        // Delete expired backups sequentially to avoid overwhelming the provider
        for (const entry of result.delete) {
            const fullPath = remotePath.endsWith('/')
                ? `${remotePath}${entry.name}`
                : `${remotePath}/${entry.name}`;
            this.log.info({ backup: entry.name }, 'Deleting expired backup');
            await provider.delete(fullPath);
        }

        this.log.info('Retention cleanup complete');
        return result;
    }
}
