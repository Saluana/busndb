import type { Driver, Row, DBConfig } from '../types.js';
import { DatabaseError } from '../errors.js';

export abstract class BaseDriver implements Driver {
    protected isClosed = false;
    protected isInTransaction = false;

    constructor(config: DBConfig) {
        // Child classes must call this.initializeDriver(config) after their setup
    }

    protected abstract initializeDriver(config: DBConfig): void;

    protected configureSQLite(config: DBConfig): void {
        const sqliteConfig = {
            journalMode: 'WAL',
            synchronous: 'NORMAL',
            busyTimeout: 5000,
            cacheSize: -64000, // 64MB
            tempStore: 'MEMORY',
            lockingMode: 'NORMAL',
            autoVacuum: 'NONE',
            walCheckpoint: 1000,
            ...config.sqlite,
        };

        try {
            this.execSync(`PRAGMA journal_mode = ${sqliteConfig.journalMode}`);
            this.execSync(`PRAGMA synchronous = ${sqliteConfig.synchronous}`);
            this.execSync(`PRAGMA busy_timeout = ${sqliteConfig.busyTimeout}`);
            this.execSync(`PRAGMA cache_size = ${sqliteConfig.cacheSize}`);
            this.execSync(`PRAGMA temp_store = ${sqliteConfig.tempStore}`);
            this.execSync(`PRAGMA locking_mode = ${sqliteConfig.lockingMode}`);
            this.execSync(`PRAGMA auto_vacuum = ${sqliteConfig.autoVacuum}`);

            if (sqliteConfig.journalMode === 'WAL') {
                this.execSync(
                    `PRAGMA wal_autocheckpoint = ${sqliteConfig.walCheckpoint}`
                );
            }

            this.execSync('PRAGMA foreign_keys = ON');
        } catch (error) {
            console.warn(
                'Warning: Failed to apply some SQLite configuration:',
                error
            );
        }
    }

    protected handleClosedDatabase(error: unknown): boolean {
        return (
            error instanceof Error &&
            (error.message.includes('closed database') ||
                error.message.includes('Database is closed'))
        );
    }


    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        if (this.isInTransaction) {
            return await fn();
        }

        this.isInTransaction = true;
        await this.exec('BEGIN');
        try {
            const result = await fn();
            await this.exec('COMMIT');
            this.isInTransaction = false;
            return result;
        } catch (error) {
            // Enhanced rollback error recovery
            try {
                await this.exec('ROLLBACK');
            } catch (rollbackError) {
                // If rollback fails, log the error but don't override the original error
                console.warn('Failed to rollback transaction:', rollbackError);
                
                // If database is closed, handle gracefully
                if (this.handleClosedDatabase(rollbackError)) {
                    this.isClosed = true;
                    this.isInTransaction = false;
                    throw new DatabaseError(
                        `Transaction failed and database was closed during rollback: ${(error as Error).message}`,
                        'TRANSACTION_ROLLBACK_DB_CLOSED'
                    );
                }
            }
            
            this.isInTransaction = false;
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.isClosed) return;
        this.isClosed = true;
        await this.closeDatabase();
    }

    closeSync(): void {
        if (this.isClosed) return;
        this.isClosed = true;
        this.closeDatabaseSync();
    }

    protected abstract closeDatabase(): Promise<void>;
    protected abstract closeDatabaseSync(): void;

    abstract exec(sql: string, params?: any[]): Promise<void>;
    abstract query(sql: string, params?: any[]): Promise<Row[]>;
    abstract execSync(sql: string, params?: any[]): void;
    abstract querySync(sql: string, params?: any[]): Row[];
}
