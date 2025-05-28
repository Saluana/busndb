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
            this.exec('PRAGMA journal_mode = WAL');
            this.exec('PRAGMA foreign_keys = ON');
            this.exec('PRAGMA synchronous = NORMAL');
        } catch (error) {
            throw new DatabaseError(`Failed to initialize database: ${error}`);
        }
    }

    exec(sql: string, params: any[] = []): void {
        try {
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    query(sql: string, params: any[] = []): Row[] {
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
            this.exec('BEGIN');
            try {
                const result = await fn();
                this.exec('COMMIT');
                this.isInTransaction = false;
                resolve(result);
            } catch (error) {
                this.exec('ROLLBACK');
                this.isInTransaction = false;
                reject(error);
            }
        });
    }

    close(): void {
        this.db.close();
    }
}
