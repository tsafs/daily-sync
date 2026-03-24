import { describe, it, expect, vi } from 'vitest';
import {
    parseBackupName,
    evaluateRetention,
    RetentionService,
    type BackupEntry,
    type GfsConfig,
} from '../services/retention.js';
import type { BackupProvider, RemoteEntry } from '../providers/provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a BackupEntry from a compact date string YYYYMMDD (time defaults to 02:00:00). */
function entry(dateStr: string, time = '020000'): BackupEntry {
    const name = `backup_${dateStr}_${time}`;
    const parsed = parseBackupName(name);
    if (!parsed) throw new Error(`Invalid test date: ${dateStr}_${time}`);
    return parsed;
}

/** Shorthand: extract just the names from a retention result's delete list. */
function deletedNames(
    backups: BackupEntry[],
    config: GfsConfig,
    now: Date,
): string[] {
    const result = evaluateRetention(backups, config, now);
    return result.delete.map((e) => e.name).sort();
}

/** Shorthand: extract just the names from a retention result's keep list. */
function keptNames(
    backups: BackupEntry[],
    config: GfsConfig,
    now: Date,
): string[] {
    const result = evaluateRetention(backups, config, now);
    return result.keep.map((k) => k.entry.name).sort();
}

/** Get the tiers for a kept backup by name. */
function tiersFor(
    backups: BackupEntry[],
    config: GfsConfig,
    now: Date,
    name: string,
): string[] {
    const result = evaluateRetention(backups, config, now);
    const kept = result.keep.find((k) => k.entry.name === name);
    return kept ? kept.tiers.sort() : [];
}

// ---------------------------------------------------------------------------
// parseBackupName
// ---------------------------------------------------------------------------

describe('parseBackupName', () => {
    it('should parse a valid backup directory name', () => {
        const result = parseBackupName('backup_20260315_020000');
        expect(result).not.toBeNull();
        expect(result!.name).toBe('backup_20260315_020000');
        expect(result!.timestamp).toEqual(new Date(2026, 2, 15, 2, 0, 0));
    });

    it('should parse midnight timestamps', () => {
        const result = parseBackupName('backup_20260101_000000');
        expect(result).not.toBeNull();
        expect(result!.timestamp).toEqual(new Date(2026, 0, 1, 0, 0, 0));
    });

    it('should parse end-of-day timestamps', () => {
        const result = parseBackupName('backup_20261231_235959');
        expect(result).not.toBeNull();
        expect(result!.timestamp).toEqual(new Date(2026, 11, 31, 23, 59, 59));
    });

    it('should return null for non-matching names', () => {
        expect(parseBackupName('not_a_backup')).toBeNull();
        expect(parseBackupName('backup_2026031_020000')).toBeNull(); // short year/month
        expect(parseBackupName('backup_20260315')).toBeNull(); // missing time
        expect(parseBackupName('')).toBeNull();
        expect(parseBackupName('backup_20260315_02000')).toBeNull(); // time too short
    });

    it('should return null for names with extra characters', () => {
        expect(parseBackupName('backup_20260315_020000_extra')).toBeNull();
        expect(parseBackupName('prefix_backup_20260315_020000')).toBeNull();
    });

    it('should return null for invalid date components', () => {
        // Month 13 doesn't exist
        expect(parseBackupName('backup_20261315_020000')).toBeNull();
        // Month 0 doesn't exist
        expect(parseBackupName('backup_20260015_020000')).toBeNull();
        // Day 32 doesn't exist
        expect(parseBackupName('backup_20260332_020000')).toBeNull();
        // Day 0 doesn't exist
        expect(parseBackupName('backup_20260300_020000')).toBeNull();
        // Hour 24
        expect(parseBackupName('backup_20260315_240000')).toBeNull();
        // Minute 60
        expect(parseBackupName('backup_20260315_026000')).toBeNull();
        // Second 60
        expect(parseBackupName('backup_20260315_020060')).toBeNull();
    });

    it('should return null for dates that roll over (e.g. Feb 30)', () => {
        // Feb 30 doesn't exist — JS Date would roll to March 2
        expect(parseBackupName('backup_20260230_020000')).toBeNull();
        // Feb 29 in a non-leap year
        expect(parseBackupName('backup_20250229_020000')).toBeNull();
        // Apr 31 doesn't exist
        expect(parseBackupName('backup_20260431_020000')).toBeNull();
    });

    it('should accept Feb 29 in a leap year', () => {
        // 2024 is a leap year
        const result = parseBackupName('backup_20240229_020000');
        expect(result).not.toBeNull();
        expect(result!.timestamp).toEqual(new Date(2024, 1, 29, 2, 0, 0));
    });
});

// ---------------------------------------------------------------------------
// evaluateRetention — Daily tier
// ---------------------------------------------------------------------------

describe('evaluateRetention — Daily tier', () => {
    const now = new Date(2026, 2, 24, 10, 0, 0); // March 24, 2026, 10:00 AM

    it('should keep all backups within the daily window', () => {
        const config: GfsConfig = { daily: 7, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260318'), // 6 days ago — last day of window
            entry('20260319'),
            entry('20260320'),
            entry('20260321'),
            entry('20260322'),
            entry('20260323'),
            entry('20260324'), // today
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(7);
        expect(result.delete).toHaveLength(0);
    });

    it('should delete backups outside the daily window', () => {
        const config: GfsConfig = { daily: 3, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260320'), // 4 days ago — outside window
            entry('20260321'), // 3 days ago — outside window
            entry('20260322'), // 2 days ago — inside (day 1 of 3-day window)
            entry('20260323'), // yesterday — inside
            entry('20260324'), // today — inside
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260322_020000',
            'backup_20260323_020000',
            'backup_20260324_020000',
        ]);
    });

    it('should handle daily=1 (keep only today)', () => {
        const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260323'),
            entry('20260324'),
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(1);
        expect(result.keep[0].entry.name).toBe('backup_20260324_020000');
    });

    it('should keep multiple backups from the same day', () => {
        const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260324', '020000'),
            entry('20260324', '140000'),
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// evaluateRetention — Weekly tier
// ---------------------------------------------------------------------------

describe('evaluateRetention — Weekly tier', () => {
    // March 24, 2026 is a Tuesday
    // Current week starts Mon March 23
    const now = new Date(2026, 2, 24, 10, 0, 0);

    it('should keep the oldest backup from each week', () => {
        const config: GfsConfig = { daily: 0, weekly: 3, monthly: 0 };
        const backups = [
            // Week of March 9 (Mon Mar 9 – Sun Mar 15)
            entry('20260309'), // oldest in week → keep
            entry('20260311'),
            entry('20260313'),
            // Week of March 16 (Mon Mar 16 – Sun Mar 22)
            entry('20260316'), // oldest in week → keep
            entry('20260318'),
            entry('20260320'),
            // Current week (Mon March 23 – Sun March 29)
            entry('20260323'), // oldest in week → keep
            entry('20260324'),
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260309_020000',
            'backup_20260316_020000',
            'backup_20260323_020000',
        ]);
    });

    it('should not reach back further than N weeks', () => {
        const config: GfsConfig = { daily: 0, weekly: 2, monthly: 0 };
        const backups = [
            entry('20260309'), // 2 weeks ago — outside weekly=2 window
            entry('20260316'), // 1 week ago — inside
            entry('20260323'), // current week — inside
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260316_020000',
            'backup_20260323_020000',
        ]);
    });

    it('should handle now on a Sunday (end of ISO week)', () => {
        // March 29, 2026 is a Sunday → ISO week started Mon Mar 23
        const sundayNow = new Date(2026, 2, 29, 10, 0, 0);
        const config: GfsConfig = { daily: 0, weekly: 2, monthly: 0 };
        const backups = [
            // Previous week (Mon Mar 16 – Sun Mar 22)
            entry('20260316'),
            entry('20260322'), // Sunday — still in previous week
            // Current week (Mon Mar 23 – Sun Mar 29)
            entry('20260323'),
            entry('20260329'),
        ];

        const kept = keptNames(backups, config, sundayNow);
        expect(kept).toEqual([
            'backup_20260316_020000',
            'backup_20260323_020000',
        ]);
    });

    it('should handle now on a Monday (start of ISO week)', () => {
        // March 23, 2026 is a Monday
        const mondayNow = new Date(2026, 2, 23, 10, 0, 0);
        const config: GfsConfig = { daily: 0, weekly: 2, monthly: 0 };
        const backups = [
            entry('20260309'), // Mon of 2 weeks ago — outside
            entry('20260316'), // Mon of 1 week ago — inside
            entry('20260323'), // Mon of current week — inside
        ];

        const kept = keptNames(backups, config, mondayNow);
        expect(kept).toEqual([
            'backup_20260316_020000',
            'backup_20260323_020000',
        ]);
    });

    it('should assign Sunday backup to the correct ISO week', () => {
        // Sunday March 22 belongs to ISO week starting Mon Mar 16
        const config: GfsConfig = { daily: 0, weekly: 3, monthly: 0 };
        const backups = [
            entry('20260316'), // Mon — oldest in week of Mar 16
            entry('20260322'), // Sun — still in week of Mar 16 (NOT week of Mar 23)
            entry('20260323'), // Mon — oldest in current week
        ];

        const kept = keptNames(backups, config, now);
        // Mar 16 is oldest in its week, Mar 23 is oldest in current week
        expect(kept).toEqual([
            'backup_20260316_020000',
            'backup_20260323_020000',
        ]);
    });

    it('should handle weekly=1 (only current week)', () => {
        const config: GfsConfig = { daily: 0, weekly: 1, monthly: 0 };
        const backups = [
            entry('20260316'), // previous week — outside
            entry('20260323'), // current week — keep
            entry('20260324'), // current week — not kept (not oldest)
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual(['backup_20260323_020000']);
    });

    it('should handle cross-year weekly boundary', () => {
        // Jan 2, 2026 is a Friday. ISO week starts Mon Dec 29, 2025.
        const crossYearNow = new Date(2026, 0, 2, 10, 0, 0);
        const config: GfsConfig = { daily: 0, weekly: 2, monthly: 0 };
        const backups = [
            entry('20251222'), // Mon of previous week — inside
            entry('20251229'), // Mon of current week (Dec 29) — inside
            entry('20260101'), // Thu — also in current week
        ];

        const kept = keptNames(backups, config, crossYearNow);
        expect(kept).toEqual([
            'backup_20251222_020000',
            'backup_20251229_020000',
        ]);
    });
});

// ---------------------------------------------------------------------------
// evaluateRetention — Monthly tier
// ---------------------------------------------------------------------------

describe('evaluateRetention — Monthly tier', () => {
    const now = new Date(2026, 2, 24, 10, 0, 0); // March 24, 2026

    it('should keep the oldest backup from each month', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 3 };
        const backups = [
            // January 2026
            entry('20260105'), // oldest in month → keep
            entry('20260115'),
            // February 2026
            entry('20260201'), // oldest in month → keep
            entry('20260215'),
            // March 2026
            entry('20260301'), // oldest in month → keep
            entry('20260315'),
            entry('20260324'),
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260105_020000',
            'backup_20260201_020000',
            'backup_20260301_020000',
        ]);
    });

    it('should not reach back further than N months', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 2 };
        const backups = [
            entry('20260115'), // January — outside monthly=2
            entry('20260215'), // February — inside
            entry('20260315'), // March — inside
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260215_020000',
            'backup_20260315_020000',
        ]);
    });

    it('should handle month boundaries across years', () => {
        const now = new Date(2026, 1, 15, 10, 0, 0); // Feb 15, 2026
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 3 };
        const backups = [
            entry('20251215'), // December 2025 — inside
            entry('20260110'), // January 2026 — inside
            entry('20260210'), // February 2026 — inside
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toHaveLength(3);
    });

    it('should handle monthly=1 (only current month)', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 1 };
        const backups = [
            entry('20260215'), // February — outside
            entry('20260301'), // March — oldest in current month → keep
            entry('20260315'), // March — not oldest
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual(['backup_20260301_020000']);
    });

    it('should handle months with different lengths', () => {
        // Now is March 31 — previous month (Feb) only has 28 days
        const now31 = new Date(2026, 2, 31, 10, 0, 0);
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 2 };
        const backups = [
            entry('20260201'), // Feb 1 — oldest in Feb → keep
            entry('20260228'), // Feb 28 — not oldest
            entry('20260301'), // Mar 1 — oldest in Mar → keep
        ];

        const kept = keptNames(backups, config, now31);
        expect(kept).toEqual([
            'backup_20260201_020000',
            'backup_20260301_020000',
        ]);
    });

    it('should handle January with large monthly lookback', () => {
        // Now is Jan 15 with monthly=12 — should go back to Feb of previous year
        const janNow = new Date(2026, 0, 15, 10, 0, 0);
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 12 };
        const backups = [
            entry('20250215'), // Feb 2025 — inside
            entry('20250615'), // Jun 2025 — inside
            entry('20251015'), // Oct 2025 — inside
            entry('20260105'), // Jan 2026 — inside
        ];

        const result = evaluateRetention(backups, config, janNow);
        expect(result.keep).toHaveLength(4);
        expect(result.delete).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// evaluateRetention — Combined tiers (GFS)
// ---------------------------------------------------------------------------

describe('evaluateRetention — Combined GFS tiers', () => {
    // March 24, 2026 is a Tuesday
    const now = new Date(2026, 2, 24, 10, 0, 0);

    it('should produce a union of all tier keep sets', () => {
        const config: GfsConfig = { daily: 3, weekly: 2, monthly: 2 };
        const backups = [
            entry('20260215'), // Feb — monthly keeps this
            entry('20260301'), // Mar — monthly keeps this
            entry('20260316'), // last week — weekly keeps this
            entry('20260322'), // inside daily window
            entry('20260323'), // inside daily window (also oldest in current week for weekly)
            entry('20260324'), // today — inside daily window
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(6);
        expect(result.delete).toHaveLength(0);
    });

    it('should assign multiple tiers when a backup satisfies several', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };
        // A backup that is the oldest in both its week and its month
        const backups = [
            entry('20260301'), // oldest in March → monthly; also in a week → could be weekly
        ];

        const result = evaluateRetention(backups, config, now);
        const tiers = result.keep[0].tiers;
        expect(tiers).toContain('monthly');
    });

    it('should assign daily + weekly + monthly tiers to a single backup', () => {
        // March 24 is a Tuesday. Current week started Mon Mar 23.
        // Use a narrow window so we can precisely control tier assignment.
        const config: GfsConfig = { daily: 3, weekly: 1, monthly: 1 };
        // Mar 23 is: within daily window (Mar 22-24), oldest in current week, oldest in March
        const backups = [
            entry('20260323'), // daily ✓, weekly ✓ (oldest in current week), monthly ✓ (oldest in Mar)
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(1);
        const tiers = result.keep[0].tiers.sort();
        expect(tiers).toEqual(['daily', 'monthly', 'weekly']);
    });

    it('should not double-count a backup in the keep list', () => {
        // A backup satisfying all three tiers should appear once in keep, not three times
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };
        const backups = [entry('20260323')];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(1);
        expect(result.delete).toHaveLength(0);
    });

    it('should handle default config (daily=7, weekly=4, monthly=6)', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };

        // Simulate 60 days of daily backups
        const backups: BackupEntry[] = [];
        for (let i = 59; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr =
                `${d.getFullYear()}` +
                `${(d.getMonth() + 1).toString().padStart(2, '0')}` +
                `${d.getDate().toString().padStart(2, '0')}`;
            backups.push(entry(dateStr));
        }

        const result = evaluateRetention(backups, config, now);

        // Daily: 7, Weekly: up to 4 additional, Monthly: up to 6 additional
        // Exact count depends on overlaps, but we should have reasonable depth
        expect(result.keep.length).toBeGreaterThanOrEqual(7);
        expect(result.keep.length).toBeLessThanOrEqual(17); // theoretical max
        expect(result.delete.length).toBe(backups.length - result.keep.length);
    });
});

// ---------------------------------------------------------------------------
// evaluateRetention — Edge cases
// ---------------------------------------------------------------------------

describe('evaluateRetention — Edge cases', () => {
    const now = new Date(2026, 2, 24, 10, 0, 0);

    it('should handle empty backup list', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };
        const result = evaluateRetention([], config, now);
        expect(result.keep).toHaveLength(0);
        expect(result.delete).toHaveLength(0);
    });

    it('should handle single backup inside daily window', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };
        const backups = [entry('20260324')];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(1);
        expect(result.delete).toHaveLength(0);
    });

    it('should handle single backup outside all windows', () => {
        const config: GfsConfig = { daily: 1, weekly: 1, monthly: 1 };
        // A backup from a year ago
        const backups = [entry('20250101')];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(0);
        expect(result.delete).toHaveLength(1);
    });

    it('should handle all tiers set to zero (delete everything)', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 0 };
        const backups = [entry('20260324'), entry('20260323')];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(0);
        expect(result.delete).toHaveLength(2);
    });

    it('should handle backups with identical timestamps', () => {
        const config: GfsConfig = { daily: 7, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260324', '020000'),
            // Same date/time but different entry objects
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(1);
    });

    it('should handle backup exactly at daily cutoff boundary', () => {
        // daily=7, now is March 24 at 10:00
        // cutoff = start of March 18
        // A backup at March 18 00:00:00 should be kept
        const config: GfsConfig = { daily: 7, weekly: 0, monthly: 0 };
        const backups = [entry('20260318', '000000')];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(1);
    });

    it('should handle backup just before daily cutoff boundary', () => {
        // daily=7, now is March 24 at 10:00
        // cutoff = start of March 18
        // A backup at March 17 23:59:59 should NOT be kept by daily
        const config: GfsConfig = { daily: 7, weekly: 0, monthly: 0 };
        const backups = [entry('20260317', '235959')];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(0);
        expect(result.delete).toHaveLength(1);
    });

    it('should handle now at exactly midnight', () => {
        const midnightNow = new Date(2026, 2, 24, 0, 0, 0);
        const config: GfsConfig = { daily: 2, weekly: 0, monthly: 0 };
        // daily=2 → keep Mar 23 and Mar 24
        const backups = [
            entry('20260322'), // outside
            entry('20260323'), // inside
            entry('20260324', '000000'), // today at midnight — inside
        ];

        const kept = keptNames(backups, config, midnightNow);
        expect(kept).toEqual([
            'backup_20260323_020000',
            'backup_20260324_000000',
        ]);
    });

    it('should handle backups with future timestamps', () => {
        // A backup dated tomorrow — should be kept by daily (it's >= cutoff)
        const config: GfsConfig = { daily: 3, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260324'), // today
            entry('20260325'), // tomorrow — future but still >= cutoff
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(2);
    });

    it('should preserve insertion order in results', () => {
        const config: GfsConfig = { daily: 7, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260324'),
            entry('20260322'),
            entry('20260323'),
        ];

        const result = evaluateRetention(backups, config, now);
        // Keep list should follow the original array order
        expect(result.keep[0].entry.name).toBe('backup_20260324_020000');
        expect(result.keep[1].entry.name).toBe('backup_20260322_020000');
        expect(result.keep[2].entry.name).toBe('backup_20260323_020000');
    });

    it('should handle backup exactly at weekly boundary (Monday 00:00:00)', () => {
        // Monday March 23 at midnight is exactly at the ISO week start
        const config: GfsConfig = { daily: 0, weekly: 2, monthly: 0 };
        const backups = [
            entry('20260316', '000000'), // Mon Mar 16 midnight — oldest in prev week
            entry('20260323', '000000'), // Mon Mar 23 midnight — oldest in current week
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260316_000000',
            'backup_20260323_000000',
        ]);
    });

    it('should handle backup exactly at monthly boundary (1st 00:00:00)', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 2 };
        const backups = [
            entry('20260201', '000000'), // Feb 1 midnight — oldest in Feb
            entry('20260301', '000000'), // Mar 1 midnight — oldest in Mar
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260201_000000',
            'backup_20260301_000000',
        ]);
    });

    it('should handle large number of backups efficiently', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 12 };
        // 365 days of backups
        const backups: BackupEntry[] = [];
        for (let i = 364; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr =
                `${d.getFullYear()}` +
                `${(d.getMonth() + 1).toString().padStart(2, '0')}` +
                `${d.getDate().toString().padStart(2, '0')}`;
            backups.push(entry(dateStr));
        }

        const result = evaluateRetention(backups, config, now);
        // Should keep daily(7) + some weekly + some monthly (with overlaps)
        expect(result.keep.length).toBeGreaterThanOrEqual(7);
        expect(result.keep.length).toBeLessThanOrEqual(23); // 7 + 4 + 12 theoretical max
        expect(result.keep.length + result.delete.length).toBe(365);
    });
});

// ---------------------------------------------------------------------------
// RetentionService
// ---------------------------------------------------------------------------

describe('RetentionService', () => {
    function createMockProvider(entries: RemoteEntry[]): BackupProvider {
        return {
            name: 'mock',
            initialize: vi.fn().mockResolvedValue(undefined),
            upload: vi.fn().mockResolvedValue(undefined),
            list: vi.fn().mockResolvedValue(entries),
            delete: vi.fn().mockResolvedValue(undefined),
            mkdir: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
        };
    }

    describe('listBackups', () => {
        it('should parse and sort backup directories', async () => {
            const provider = createMockProvider([
                { name: 'backup_20260324_020000', isDirectory: true },
                { name: 'backup_20260322_020000', isDirectory: true },
                { name: 'backup_20260323_020000', isDirectory: true },
            ]);

            const service = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
            const backups = await service.listBackups(provider, '/backups');

            expect(backups).toHaveLength(3);
            // Should be sorted oldest first
            expect(backups[0].name).toBe('backup_20260322_020000');
            expect(backups[1].name).toBe('backup_20260323_020000');
            expect(backups[2].name).toBe('backup_20260324_020000');
        });

        it('should ignore non-directory entries', async () => {
            const provider = createMockProvider([
                { name: 'backup_20260324_020000', isDirectory: true },
                { name: 'backup_20260323_020000', isDirectory: false }, // file — ignored
                { name: 'README.md', isDirectory: false },
            ]);

            const service = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
            const backups = await service.listBackups(provider, '/backups');

            expect(backups).toHaveLength(1);
        });

        it('should ignore directories with non-matching names', async () => {
            const provider = createMockProvider([
                { name: 'backup_20260324_020000', isDirectory: true },
                { name: 'some_other_dir', isDirectory: true },
                { name: 'backup_invalid', isDirectory: true },
            ]);

            const service = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
            const backups = await service.listBackups(provider, '/backups');

            expect(backups).toHaveLength(1);
        });
    });

    describe('apply', () => {
        it('should delete expired backups via the provider', async () => {
            const now = new Date(2026, 2, 24, 10, 0, 0);
            const config: GfsConfig = { daily: 2, weekly: 0, monthly: 0 };

            const provider = createMockProvider([
                { name: 'backup_20260320_020000', isDirectory: true }, // outside window
                { name: 'backup_20260321_020000', isDirectory: true }, // outside window
                { name: 'backup_20260323_020000', isDirectory: true }, // inside
                { name: 'backup_20260324_020000', isDirectory: true }, // inside
            ]);

            const service = new RetentionService(config);
            const result = await service.apply(provider, '/backups', now);

            expect(result.keep).toHaveLength(2);
            expect(result.delete).toHaveLength(2);

            // Verify delete was called for expired backups
            expect(provider.delete).toHaveBeenCalledTimes(2);
            expect(provider.delete).toHaveBeenCalledWith('/backups/backup_20260320_020000');
            expect(provider.delete).toHaveBeenCalledWith('/backups/backup_20260321_020000');
        });

        it('should handle trailing slash in remote path', async () => {
            const now = new Date(2026, 2, 24, 10, 0, 0);
            const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };

            const provider = createMockProvider([
                { name: 'backup_20260320_020000', isDirectory: true },
                { name: 'backup_20260324_020000', isDirectory: true },
            ]);

            const service = new RetentionService(config);
            await service.apply(provider, '/backups/', now);

            expect(provider.delete).toHaveBeenCalledWith('/backups/backup_20260320_020000');
        });

        it('should not delete anything when all backups are within retention', async () => {
            const now = new Date(2026, 2, 24, 10, 0, 0);
            const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };

            const provider = createMockProvider([
                { name: 'backup_20260323_020000', isDirectory: true },
                { name: 'backup_20260324_020000', isDirectory: true },
            ]);

            const service = new RetentionService(config);
            const result = await service.apply(provider, '/backups', now);

            expect(result.keep).toHaveLength(2);
            expect(result.delete).toHaveLength(0);
            expect(provider.delete).not.toHaveBeenCalled();
        });

        it('should not call delete when backup list is empty', async () => {
            const provider = createMockProvider([]);
            const service = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
            const result = await service.apply(provider, '/backups');

            expect(result.keep).toHaveLength(0);
            expect(result.delete).toHaveLength(0);
            expect(provider.delete).not.toHaveBeenCalled();
        });

        it('should propagate delete errors from the provider', async () => {
            const now = new Date(2026, 2, 24, 10, 0, 0);
            const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };

            const provider = createMockProvider([
                { name: 'backup_20260320_020000', isDirectory: true },
                { name: 'backup_20260324_020000', isDirectory: true },
            ]);
            (provider.delete as ReturnType<typeof vi.fn>).mockRejectedValue(
                new Error('Network error'),
            );

            const service = new RetentionService(config);
            await expect(service.apply(provider, '/backups', now)).rejects.toThrow(
                'Network error',
            );
        });

        it('should delete sequentially (not concurrently)', async () => {
            const now = new Date(2026, 2, 24, 10, 0, 0);
            const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };

            const callOrder: string[] = [];
            const provider = createMockProvider([
                { name: 'backup_20260320_020000', isDirectory: true },
                { name: 'backup_20260321_020000', isDirectory: true },
                { name: 'backup_20260322_020000', isDirectory: true },
                { name: 'backup_20260324_020000', isDirectory: true },
            ]);
            (provider.delete as ReturnType<typeof vi.fn>).mockImplementation(
                async (path: string) => {
                    callOrder.push(`start:${path}`);
                    // Simulate async work
                    await new Promise((r) => setTimeout(r, 10));
                    callOrder.push(`end:${path}`);
                },
            );

            const service = new RetentionService(config);
            await service.apply(provider, '/backups', now);

            // Verify sequential: each start-end pair completes before the next starts
            expect(callOrder).toEqual([
                'start:/backups/backup_20260320_020000',
                'end:/backups/backup_20260320_020000',
                'start:/backups/backup_20260321_020000',
                'end:/backups/backup_20260321_020000',
                'start:/backups/backup_20260322_020000',
                'end:/backups/backup_20260322_020000',
            ]);
        });
    });

    describe('evaluate', () => {
        it('should delegate to evaluateRetention with the service config', () => {
            const config: GfsConfig = { daily: 3, weekly: 0, monthly: 0 };
            const service = new RetentionService(config);
            const now = new Date(2026, 2, 24, 10, 0, 0);
            const backups = [entry('20260322'), entry('20260323'), entry('20260324')];

            const result = service.evaluate(backups, now);
            expect(result.keep).toHaveLength(3);
            expect(result.delete).toHaveLength(0);
        });
    });
});

// ---------------------------------------------------------------------------
// Additional edge cases and coverage
// ---------------------------------------------------------------------------

describe('evaluateRetention — Additional edge cases', () => {
    const now = new Date(2026, 2, 24, 10, 0, 0); // March 24, 2026

    // --- daily=0 with other tiers active ---

    it('should keep nothing from daily tier when daily=0, but weekly still works', () => {
        const config: GfsConfig = { daily: 0, weekly: 2, monthly: 0 };
        const backups = [
            entry('20260316'), // weekly keeps oldest in prev week
            entry('20260323'), // weekly keeps oldest in current week
            entry('20260324'), // NOT kept (daily=0, not oldest in week)
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260316_020000',
            'backup_20260323_020000',
        ]);
    });

    it('should keep nothing from daily tier when daily=0, but monthly still works', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 1 };
        const backups = [
            entry('20260301'), // monthly keeps oldest in March
            entry('20260324'), // NOT kept (daily=0, not oldest in month)
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual(['backup_20260301_020000']);
    });

    // --- Negative config values (robustness) ---

    it('should keep nothing with negative daily value', () => {
        const config: GfsConfig = { daily: -1, weekly: 0, monthly: 0 };
        const backups = [entry('20260324')];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(0);
        expect(result.delete).toHaveLength(1);
    });

    // --- Gaps in backup schedule ---

    it('should handle weeks with no backups (gaps)', () => {
        const config: GfsConfig = { daily: 0, weekly: 4, monthly: 0 };
        // Weeks: Mar 23 (current), Mar 16, Mar 9, Mar 2
        // Missing backup for week of Mar 9
        const backups = [
            entry('20260302'), // week of Mar 2
            // no backup for week of Mar 9
            entry('20260316'), // week of Mar 16
            entry('20260323'), // week of Mar 23
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20260302_020000',
            'backup_20260316_020000',
            'backup_20260323_020000',
        ]);
        // Only 3 kept even though weekly=4, because one week had no backups
    });

    it('should handle months with no backups (gaps)', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 4 };
        // Months: March, Feb, Jan, Dec 2025
        // Missing backup for January
        const backups = [
            entry('20251215'), // December 2025
            // no backup for January 2026
            entry('20260215'), // February 2026
            entry('20260315'), // March 2026
        ];

        const kept = keptNames(backups, config, now);
        expect(kept).toEqual([
            'backup_20251215_020000',
            'backup_20260215_020000',
            'backup_20260315_020000',
        ]);
    });

    // --- Identical timestamps in same week ---

    it('should handle two backups with identical timestamps in the same week', () => {
        // This is an edge case — two BackupEntry objects have different names
        // but the same timestamp. reduce should deterministically pick one.
        const config: GfsConfig = { daily: 0, weekly: 1, monthly: 0 };
        const b1: BackupEntry = { name: 'backup_20260323_020000', timestamp: new Date(2026, 2, 23, 2, 0, 0) };
        const b2: BackupEntry = { name: 'backup_20260323_020001', timestamp: new Date(2026, 2, 23, 2, 0, 0) };
        // Same timestamp but different names — `reduce` with `<=` keeps `a` (first one)
        const backups = [b1, b2];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(1);
        expect(result.delete).toHaveLength(1);
        // First one wins because reduce uses <=
        expect(result.keep[0].entry.name).toBe('backup_20260323_020000');
    });

    // --- Monthly boundary precision ---

    it('should distinguish last second of month from first second of next', () => {
        const config: GfsConfig = { daily: 0, weekly: 0, monthly: 2 };
        const backups = [
            entry('20260228', '235959'), // Feb 28 23:59:59 — in February
            entry('20260301', '000000'), // Mar 1 00:00:00 — in March
        ];

        const kept = keptNames(backups, config, now);
        // Both should be kept — each is the oldest in its own month
        expect(kept).toEqual([
            'backup_20260228_235959',
            'backup_20260301_000000',
        ]);
    });

    // --- ISO weekly boundary: Sunday→Monday ---

    it('should distinguish Sunday 23:59:59 from Monday 00:00:00 at ISO week boundary', () => {
        const config: GfsConfig = { daily: 0, weekly: 2, monthly: 0 };
        const backups = [
            entry('20260322', '235959'), // Sunday 23:59:59 — ISO week of Mar 16
            entry('20260323', '000000'), // Monday 00:00:00 — ISO week of Mar 23
        ];

        const kept = keptNames(backups, config, now);
        // Both kept — each is the oldest in its own ISO week
        expect(kept).toEqual([
            'backup_20260322_235959',
            'backup_20260323_000000',
        ]);
    });

    // --- Tier tagging verification (using tiersFor helper) ---

    it('should tag a backup with only the daily tier when not oldest in week or month', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };
        const backups = [
            entry('20260301'), // oldest in March (monthly) + oldest in its week (weekly) + daily
            entry('20260324'), // daily only (not oldest in March, not oldest in current week if Mar 23 exists)
            entry('20260323'), // oldest in current week (weekly) + daily
        ];

        const tiers324 = tiersFor(backups, config, now, 'backup_20260324_020000');
        expect(tiers324).toEqual(['daily']);
    });

    it('should tag monthly+weekly+daily when a backup satisfies all three', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };
        // Mar 2 is Monday — it's the oldest in March, oldest in week of Mar 2, and within daily=7? No.
        // daily=7 from Mar 24 => cutoff is Mar 18. Mar 2 is outside daily.
        // Use a backup that IS within daily window AND is oldest in its week AND oldest in month.
        // Mar 23 (Monday) is oldest in current week, but not oldest in March if earlier backups exist.
        // Use only one backup: Mar 23. daily=3 => cutoff Mar 22. ✓ weekly=1 => current week oldest. ✓ monthly=1 => oldest in March. ✓
        const config2: GfsConfig = { daily: 3, weekly: 1, monthly: 1 };
        const backups2 = [entry('20260323')];

        const tiers = tiersFor(backups2, config2, now, 'backup_20260323_020000');
        expect(tiers).toEqual(['daily', 'monthly', 'weekly']);
    });

    // --- Unsorted input ---

    it('should produce correct results regardless of input order', () => {
        const config: GfsConfig = { daily: 3, weekly: 2, monthly: 2 };
        // Deliberately unsorted
        const backups = [
            entry('20260324'),
            entry('20260215'),
            entry('20260322'),
            entry('20260301'),
            entry('20260316'),
            entry('20260323'),
        ];

        // Same backups, sorted
        const backupsSorted = [
            entry('20260215'),
            entry('20260301'),
            entry('20260316'),
            entry('20260322'),
            entry('20260323'),
            entry('20260324'),
        ];

        const resultUnsorted = evaluateRetention(backups, config, now);
        const resultSorted = evaluateRetention(backupsSorted, config, now);

        // Same names should be kept (order within may differ)
        const unsortedKept = resultUnsorted.keep.map((k) => k.entry.name).sort();
        const sortedKept = resultSorted.keep.map((k) => k.entry.name).sort();
        expect(unsortedKept).toEqual(sortedKept);

        const unsortedDeleted = resultUnsorted.delete.map((e) => e.name).sort();
        const sortedDeleted = resultSorted.delete.map((e) => e.name).sort();
        expect(unsortedDeleted).toEqual(sortedDeleted);
    });

    // --- All backups in a single day ---

    it('should keep all backups when multiple runs happen on the same day within daily window', () => {
        const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260324', '010000'),
            entry('20260324', '060000'),
            entry('20260324', '120000'),
            entry('20260324', '180000'),
        ];

        const result = evaluateRetention(backups, config, now);
        expect(result.keep).toHaveLength(4);
        expect(result.delete).toHaveLength(0);
    });

    // --- daily=1 when now is very early ---

    it('should handle daily=1 when now is at 00:01 (just after midnight)', () => {
        const earlyNow = new Date(2026, 2, 24, 0, 1, 0);
        const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };
        const backups = [
            entry('20260323', '230000'), // yesterday 11 PM — outside
            entry('20260324', '000000'), // today midnight — inside
        ];

        const result = evaluateRetention(backups, config, earlyNow);
        expect(result.keep).toHaveLength(1);
        expect(result.keep[0].entry.name).toBe('backup_20260324_000000');
    });

    // --- Extremely old backups ---

    it('should delete very old backups not covered by any tier', () => {
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };
        const backups = [
            entry('20200101'), // 6+ years ago
            entry('20210615'), // 5+ years ago
            entry('20260324'), // today
        ];

        const result = evaluateRetention(backups, config, now);
        const keptNames = result.keep.map((k) => k.entry.name);
        expect(keptNames).toContain('backup_20260324_020000');
        expect(keptNames).not.toContain('backup_20200101_020000');
        expect(keptNames).not.toContain('backup_20210615_020000');
    });

    // --- keep + delete counts always sum to total ---

    it('should always have keep + delete = total backups', () => {
        const configs: GfsConfig[] = [
            { daily: 0, weekly: 0, monthly: 0 },
            { daily: 1, weekly: 0, monthly: 0 },
            { daily: 0, weekly: 1, monthly: 0 },
            { daily: 0, weekly: 0, monthly: 1 },
            { daily: 7, weekly: 4, monthly: 6 },
            { daily: 30, weekly: 12, monthly: 24 },
        ];

        const backups: BackupEntry[] = [];
        for (let i = 180; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr =
                `${d.getFullYear()}` +
                `${(d.getMonth() + 1).toString().padStart(2, '0')}` +
                `${d.getDate().toString().padStart(2, '0')}`;
            backups.push(entry(dateStr));
        }

        for (const config of configs) {
            const result = evaluateRetention(backups, config, now);
            expect(result.keep.length + result.delete.length).toBe(backups.length);
        }
    });
});

// ---------------------------------------------------------------------------
// RetentionService — Additional tests
// ---------------------------------------------------------------------------

describe('RetentionService — Additional', () => {
    function createMockProvider(entries: RemoteEntry[]): BackupProvider {
        return {
            name: 'mock',
            initialize: vi.fn().mockResolvedValue(undefined),
            upload: vi.fn().mockResolvedValue(undefined),
            list: vi.fn().mockResolvedValue(entries),
            delete: vi.fn().mockResolvedValue(undefined),
            mkdir: vi.fn().mockResolvedValue(undefined),
            dispose: vi.fn().mockResolvedValue(undefined),
        };
    }

    it('should ignore backup directories with invalid dates (e.g. Feb 30)', async () => {
        const provider = createMockProvider([
            { name: 'backup_20260230_020000', isDirectory: true }, // invalid: Feb 30
            { name: 'backup_20260324_020000', isDirectory: true }, // valid
            { name: 'backup_20250229_020000', isDirectory: true }, // invalid: non-leap Feb 29
        ]);

        const service = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
        const backups = await service.listBackups(provider, '/backups');

        expect(backups).toHaveLength(1);
        expect(backups[0].name).toBe('backup_20260324_020000');
    });

    it('should handle root path "/" in apply', async () => {
        const now = new Date(2026, 2, 24, 10, 0, 0);
        const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };

        const provider = createMockProvider([
            { name: 'backup_20260320_020000', isDirectory: true },
            { name: 'backup_20260324_020000', isDirectory: true },
        ]);

        const service = new RetentionService(config);
        await service.apply(provider, '/', now);

        expect(provider.delete).toHaveBeenCalledWith('/backup_20260320_020000');
    });

    it('should handle empty remote path in apply', async () => {
        const now = new Date(2026, 2, 24, 10, 0, 0);
        const config: GfsConfig = { daily: 1, weekly: 0, monthly: 0 };

        const provider = createMockProvider([
            { name: 'backup_20260320_020000', isDirectory: true },
            { name: 'backup_20260324_020000', isDirectory: true },
        ]);

        const service = new RetentionService(config);
        await service.apply(provider, '', now);

        expect(provider.delete).toHaveBeenCalledWith('/backup_20260320_020000');
    });

    it('should list backups in chronological order', async () => {
        const provider = createMockProvider([
            { name: 'backup_20260324_020000', isDirectory: true },
            { name: 'backup_20260101_020000', isDirectory: true },
            { name: 'backup_20260215_020000', isDirectory: true },
        ]);

        const service = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
        const backups = await service.listBackups(provider, '/backups');

        expect(backups[0].name).toBe('backup_20260101_020000');
        expect(backups[1].name).toBe('backup_20260215_020000');
        expect(backups[2].name).toBe('backup_20260324_020000');
    });

    it('should return empty list when provider has only non-backup directories', async () => {
        const provider = createMockProvider([
            { name: 'logs', isDirectory: true },
            { name: 'config', isDirectory: true },
            { name: 'backup_invalid', isDirectory: true },
        ]);

        const service = new RetentionService({ daily: 7, weekly: 4, monthly: 6 });
        const backups = await service.listBackups(provider, '/backups');

        expect(backups).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Realistic scenario tests
// ---------------------------------------------------------------------------

describe('evaluateRetention — Realistic scenarios', () => {
    it('should provide 6 months of recovery depth with default config', () => {
        // Simulate daily backups for 7 months, evaluate at the end
        const now = new Date(2026, 6, 15, 10, 0, 0); // July 15, 2026
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };

        const backups: BackupEntry[] = [];
        const start = new Date(2025, 11, 15); // Dec 15, 2025 — ~7 months
        for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
            const dateStr =
                `${d.getFullYear()}` +
                `${(d.getMonth() + 1).toString().padStart(2, '0')}` +
                `${d.getDate().toString().padStart(2, '0')}`;
            backups.push(entry(dateStr));
        }

        const result = evaluateRetention(backups, config, now);

        // Should have monthly backups going back to at least February 2026
        const monthlyKept = result.keep.filter((k) => k.tiers.includes('monthly'));
        expect(monthlyKept.length).toBeGreaterThanOrEqual(5);

        // Should have weekly backups
        const weeklyKept = result.keep.filter((k) => k.tiers.includes('weekly'));
        expect(weeklyKept.length).toBeGreaterThanOrEqual(2);

        // Should have 7 daily backups
        const dailyKept = result.keep.filter((k) => k.tiers.includes('daily'));
        expect(dailyKept.length).toBe(7);

        // Total kept should be reasonable (~12-17)
        expect(result.keep.length).toBeGreaterThanOrEqual(10);
        expect(result.keep.length).toBeLessThanOrEqual(17);
    });

    it('should handle missed backup days gracefully', () => {
        const now = new Date(2026, 2, 24, 10, 0, 0);
        const config: GfsConfig = { daily: 7, weekly: 4, monthly: 6 };

        // Only backed up on some days
        const backups = [
            entry('20260301'),
            entry('20260310'),
            entry('20260320'),
            entry('20260324'),
        ];

        const result = evaluateRetention(backups, config, now);
        // All should be kept — some by daily, some by weekly/monthly
        expect(result.keep.length).toBeGreaterThanOrEqual(3);
    });
});
