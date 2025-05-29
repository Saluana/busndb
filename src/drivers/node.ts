import type { Driver, Row, DBConfig } from '../types';
import { DatabaseError } from '../errors';

export class NodeDriver implements Driver {
    private db: any;
    private dbType: 'sqlite' | 'libsql' = 'sqlite';

    constructor(config: DBConfig = {}) {
        this.initializeDatabase(config);
    }

    private initializeDatabase(config: DBConfig): void {
        const path = config.path || ':memory:';
        
        try {
            // Try LibSQL first - it can handle both SQLite files and LibSQL URLs
            this.initializeLibSQL(config, path);
            this.dbType = 'libsql';
        } catch (libsqlError) {
            try {
                // Fallback to better-sqlite3 for pure SQLite usage
                this.initializeSQLite(path);
                this.dbType = 'sqlite';
            } catch (sqliteError) {
                // Both failed, provide helpful error message
                throw new DatabaseError(
                    'No compatible SQLite driver found. Install one of:\n' +
                    '  npm install @libsql/client    (recommended - works with SQLite and LibSQL)\n' +
                    '  npm install better-sqlite3    (SQLite only)\n' +
                    '\nLibSQL error: ' + (libsqlError instanceof Error ? libsqlError.message : String(libsqlError)) +
                    '\nSQLite error: ' + (sqliteError instanceof Error ? sqliteError.message : String(sqliteError))
                );
            }
        }
        
        // Configure SQLite pragmas (only for SQLite, not LibSQL)
        if (this.dbType === 'sqlite') {
            this.configureSQLite(config);
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

        try {
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
        } catch (error) {
            // Configuration errors shouldn't be fatal, just warn
            console.warn('Warning: Failed to apply some SQLite configuration:', error);
        }
    }

    private detectDatabaseType(config: DBConfig, path: string): 'sqlite' | 'libsql' {
        // If config explicitly specifies libsql
        if ((config as any).libsql) {
            return 'libsql';
        }
        
        // If path looks like a libsql URL
        if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('libsql://')) {
            return 'libsql';
        }
        
        // If auth token is provided, assume libsql
        if ((config as any).authToken) {
            return 'libsql';
        }
        
        // Default to sqlite
        return 'sqlite';
    }

    private initializeLibSQL(config: DBConfig, path: string): void {
        try {
            // Try to import @libsql/client
            const { createClient } = require('@libsql/client');
            
            const clientConfig: any = {};
            
            // Handle different path types
            if (path === ':memory:') {
                clientConfig.url = ':memory:';
            } else if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('libsql://')) {
                // Remote LibSQL URL
                clientConfig.url = path;
            } else {
                // Local file - LibSQL can handle regular SQLite files
                clientConfig.url = path.startsWith('file:') ? path : `file:${path}`;
            }
            
            // Add auth token if provided
            if ((config as any).authToken) {
                clientConfig.authToken = (config as any).authToken;
            }
            
            // Add sync URL if provided (for embedded replicas)
            if ((config as any).syncUrl) {
                clientConfig.syncUrl = (config as any).syncUrl;
            }
            
            this.db = createClient(clientConfig);
            
        } catch (error) {
            throw new Error(
                'libsql client not found. Install with: npm install @libsql/client'
            );
        }
    }

    private initializeSQLite(path: string): void {
        try {
            // Try better-sqlite3 first (most popular and performant)
            try {
                const Database = require('better-sqlite3');
                this.db = new Database(path === ':memory:' ? ':memory:' : path);
                return;
            } catch {
                // Fall back to sqlite3
                const sqlite3 = require('sqlite3');
                this.db = new sqlite3.Database(path);
                return;
            }
        } catch (error) {
            throw new Error(
                'SQLite driver not found. Install one of:\n' +
                '  npm install better-sqlite3  (recommended)\n' +
                '  npm install sqlite3\n' +
                'Or use libsql with: npm install @libsql/client'
            );
        }
    }

    exec(sql: string, params: any[] = []): void {
        try {
            if (this.dbType === 'libsql') {
                // LibSQL uses execute method
                const result = this.db.executeSync({ sql, args: params });
                // Execute returns a result but we don't need it for exec
            } else {
                // Handle different SQLite drivers
                if (this.db.prepare) {
                    // better-sqlite3
                    const stmt = this.db.prepare(sql);
                    stmt.run(params);
                } else {
                    // sqlite3 (callback-based, not ideal for sync interface)
                    throw new Error('sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.');
                }
            }
        } catch (error) {
            throw new DatabaseError(
                `Failed to execute: ${error instanceof Error ? error.message : String(error)}`,
                sql
            );
        }
    }

    query(sql: string, params: any[] = []): Row[] {
        try {
            if (this.dbType === 'libsql') {
                const result = this.db.executeSync({ sql, args: params });
                return result.rows.map((row: any) => this.convertLibSQLRow(row, result.columns));
            } else {
                // Handle different SQLite drivers
                if (this.db.prepare) {
                    // better-sqlite3
                    const stmt = this.db.prepare(sql);
                    return stmt.all(params);
                } else {
                    throw new Error('sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.');
                }
            }
        } catch (error) {
            throw new DatabaseError(
                `Failed to query: ${error instanceof Error ? error.message : String(error)}`,
                sql
            );
        }
    }

    private convertLibSQLRow(row: any[], columns: string[]): Row {
        const result: Row = {};
        columns.forEach((column, index) => {
            result[column] = row[index];
        });
        return result;
    }

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
        if (this.dbType === 'libsql') {
            // libsql transaction handling
            const tx = await this.db.transaction();
            try {
                const result = await fn();
                await tx.commit();
                return result;
            } catch (error) {
                await tx.rollback();
                throw error;
            }
        } else {
            // SQLite transaction handling
            if (this.db.transaction) {
                // better-sqlite3
                const transaction = this.db.transaction(() => fn());
                return transaction();
            } else {
                // Fallback transaction implementation
                this.exec('BEGIN TRANSACTION');
                try {
                    const result = await fn();
                    this.exec('COMMIT');
                    return result;
                } catch (error) {
                    this.exec('ROLLBACK');
                    throw error;
                }
            }
        }
    }

    close(): void {
        try {
            if (this.db) {
                if (this.dbType === 'libsql') {
                    if (this.db.close) {
                        this.db.close();
                    }
                } else {
                    // SQLite drivers
                    if (this.db.close) {
                        this.db.close();
                    }
                }
            }
        } catch (error) {
            // Ignore close errors
            console.warn('Warning: Error closing database connection:', error);
        }
    }
}

// Export a factory function for easier testing and configuration
export function createNodeDriver(config: DBConfig = {}): NodeDriver {
    return new NodeDriver(config);
}