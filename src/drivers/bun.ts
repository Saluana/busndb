import { Database } from 'bun:sqlite';
import type { Driver, Row, DBConfig } from '../types.js';
import { DatabaseError } from '../errors.js';

export class BunDriver implements Driver {
    private db: Database;
    private isInTransaction = false;

    constructor(config: DBConfig) {
        try {
            this.db = new Database(
                config.memory ? ':memory:' : config.path || 'database.db'
            );
            this.configureSQLite(config);
        } catch (error) {
            throw new DatabaseError(`Failed to initialize database: ${error}`);
        }
    }

    private configureSQLite(config: DBConfig): void {
        // Optimized defaults
        const sqliteConfig = {
            journalMode: 'WAL',
            synchronous: 'NORMAL',
            busyTimeout: 5000,
            cacheSize: -64000, // 64MB
            tempStore: 'MEMORY',
            lockingMode: 'NORMAL',
            autoVacuum: 'NONE',
            walCheckpoint: 1000,
            ...config.sqlite
        };

        // Apply configuration
        this.exec(`PRAGMA journal_mode = ${sqliteConfig.journalMode}`);
        this.exec(`PRAGMA synchronous = ${sqliteConfig.synchronous}`);
        this.exec(`PRAGMA busy_timeout = ${sqliteConfig.busyTimeout}`);
        this.exec(`PRAGMA cache_size = ${sqliteConfig.cacheSize}`);
        this.exec(`PRAGMA temp_store = ${sqliteConfig.tempStore}`);
        this.exec(`PRAGMA locking_mode = ${sqliteConfig.lockingMode}`);
        this.exec(`PRAGMA auto_vacuum = ${sqliteConfig.autoVacuum}`);
        
        if (sqliteConfig.journalMode === 'WAL') {
            this.exec(`PRAGMA wal_autocheckpoint = ${sqliteConfig.walCheckpoint}`);
        }

        // Always enable foreign keys
        this.exec('PRAGMA foreign_keys = ON');
    }

    // Default async methods
    async exec(sql: string, params: any[] = []): Promise<void> {
        try {
            // Use setImmediate to make it truly async
            await new Promise(resolve => setImmediate(resolve));
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    async query(sql: string, params: any[] = []): Promise<Row[]> {
        try {
            // Use setImmediate to make it truly async
            await new Promise(resolve => setImmediate(resolve));
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    // Sync methods for backward compatibility
    execSync(sql: string, params: any[] = []): void {
        try {
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    querySync(sql: string, params: any[] = []): Row[] {
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        // If we're already in a transaction, just execute the function
        // (nested transactions reuse the same context)
        if (this.isInTransaction) {
            return await fn();
        }

        // Return a promise that will execute the transaction when awaited
        return new Promise(async (resolve, reject) => {
            // Use a small delay to ensure the transaction doesn't start immediately
            await new Promise((r) => setImmediate(r));

            this.isInTransaction = true;
            await this.exec('BEGIN');
            try {
                const result = await fn();
                await this.exec('COMMIT');
                this.isInTransaction = false;
                resolve(result);
            } catch (error) {
                await this.exec('ROLLBACK');
                this.isInTransaction = false;
                reject(error);
            }
        });
    }

    async close(): Promise<void> {
        // Use setImmediate to make it truly async
        await new Promise(resolve => setImmediate(resolve));
        this.db.close();
    }

    closeSync(): void {
        this.db.close();
    }
}
