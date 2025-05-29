import { Database } from 'bun:sqlite';
import type { Driver, Row, DBConfig } from '../types.js';
import { DatabaseError } from '../errors.js';

export class BunDriver implements Driver {
    private db: Database;
    private isInTransaction = false;
    private isClosed = false;

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
        if (this.isClosed) {
            return; // Silently ignore operations on closed database
        }
        try {
            // Use setImmediate to make it truly async
            await new Promise(resolve => setImmediate(resolve));
            // Check again after async operation
            if (this.isClosed) {
                return;
            }
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            // Ignore closed database errors
            if (error instanceof Error && error.message.includes('closed database')) {
                return;
            }
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    async query(sql: string, params: any[] = []): Promise<Row[]> {
        if (this.isClosed) {
            return []; // Return empty array for closed database
        }
        try {
            // Use setImmediate to make it truly async
            await new Promise(resolve => setImmediate(resolve));
            // Check again after async operation
            if (this.isClosed) {
                return [];
            }
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            // Ignore closed database errors
            if (error instanceof Error && error.message.includes('closed database')) {
                return [];
            }
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    // Sync methods for backward compatibility
    execSync(sql: string, params: any[] = []): void {
        if (this.isClosed) {
            return; // Silently ignore operations on closed database
        }
        try {
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            // Ignore closed database errors
            if (error instanceof Error && error.message.includes('closed database')) {
                return;
            }
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    querySync(sql: string, params: any[] = []): Row[] {
        if (this.isClosed) {
            return []; // Return empty array for closed database
        }
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            // Ignore closed database errors
            if (error instanceof Error && error.message.includes('closed database')) {
                return [];
            }
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        // If we're already in a transaction, just execute the function
        // (nested transactions reuse the same context)
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
            await this.exec('ROLLBACK');
            this.isInTransaction = false;
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.isClosed) return;
        // Use setImmediate to make it truly async
        await new Promise(resolve => setImmediate(resolve));
        this.isClosed = true;
        this.db.close();
    }

    closeSync(): void {
        if (this.isClosed) return;
        this.isClosed = true;
        this.db.close();
    }
}
