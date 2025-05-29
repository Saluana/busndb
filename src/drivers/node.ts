import type { Driver, Row, DBConfig } from '../types';
import { DatabaseError } from '../errors';
import { createRequire } from 'module';

// Create require function for ES modules
const require = createRequire(import.meta.url);

export class NodeDriver implements Driver {
    private db: any;
    private dbType: 'sqlite' | 'libsql' = 'sqlite';
    private isClosed = false;

    constructor(config: DBConfig = {}) {
        this.initializeDatabase(config);
    }

    private initializeDatabase(config: DBConfig): void {
        const path = config.path || ':memory:';

        // For local files, prefer better-sqlite3 to avoid sync operation issues
        const isLocalFile =
            path === ':memory:' ||
            (!path.startsWith('http://') &&
                !path.startsWith('https://') &&
                !path.startsWith('libsql://'));

        if (
            isLocalFile &&
            !(config as any).libsql &&
            !(config as any).authToken
        ) {
            // Try better-sqlite3 first for local files
            try {
                this.initializeSQLite(path);
                this.dbType = 'sqlite';
                // Configure SQLite pragmas
                this.configureSQLite(config);
                return;
            } catch (sqliteError) {
                // If better-sqlite3 fails, try LibSQL as fallback
                try {
                    this.initializeLibSQL(config, path);
                    this.dbType = 'libsql';
                } catch (libsqlError) {
                    // Both failed, provide helpful error message
                    throw new DatabaseError(
                        'No compatible SQLite driver found. Install one of:\n' +
                            '  npm install better-sqlite3    (recommended for local files)\n' +
                            '  npm install @libsql/client    (works with SQLite and LibSQL)\n' +
                            '\nSQLite error: ' +
                            (sqliteError instanceof Error
                                ? sqliteError.message
                                : String(sqliteError)) +
                            '\nLibSQL error: ' +
                            (libsqlError instanceof Error
                                ? libsqlError.message
                                : String(libsqlError))
                    );
                }
            }
        } else {
            // For remote URLs or explicit LibSQL config, try LibSQL first
            try {
                this.initializeLibSQL(config, path);
                this.dbType = 'libsql';
            } catch (libsqlError) {
                try {
                    // Fallback to better-sqlite3 for pure SQLite usage
                    this.initializeSQLite(path);
                    this.dbType = 'sqlite';
                    // Configure SQLite pragmas
                    this.configureSQLite(config);
                } catch (sqliteError) {
                    // Both failed, provide helpful error message
                    throw new DatabaseError(
                        'No compatible SQLite driver found. Install one of:\n' +
                            '  npm install @libsql/client    (recommended - works with SQLite and LibSQL)\n' +
                            '  npm install better-sqlite3    (SQLite only)\n' +
                            '\nLibSQL error: ' +
                            (libsqlError instanceof Error
                                ? libsqlError.message
                                : String(libsqlError)) +
                            '\nSQLite error: ' +
                            (sqliteError instanceof Error
                                ? sqliteError.message
                                : String(sqliteError))
                    );
                }
            }
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
            ...config.sqlite,
        };

        try {
            // Apply configuration using sync methods since this is called from constructor
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

            // Always enable foreign keys
            this.execSync('PRAGMA foreign_keys = ON');
        } catch (error) {
            // Configuration errors shouldn't be fatal, just warn
            console.warn(
                'Warning: Failed to apply some SQLite configuration:',
                error
            );
        }
    }

    private detectDatabaseType(
        config: DBConfig,
        path: string
    ): 'sqlite' | 'libsql' {
        // If config explicitly specifies libsql
        if ((config as any).libsql) {
            return 'libsql';
        }

        // If path looks like a libsql URL
        if (
            path.startsWith('http://') ||
            path.startsWith('https://') ||
            path.startsWith('libsql://')
        ) {
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
            } else if (
                path.startsWith('http://') ||
                path.startsWith('https://') ||
                path.startsWith('libsql://')
            ) {
                // Remote LibSQL URL
                clientConfig.url = path;
            } else {
                // Local file - LibSQL can handle regular SQLite files
                clientConfig.url = path.startsWith('file:')
                    ? path
                    : `file:${path}`;
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
        let lastError: any;

        try {
            // Try better-sqlite3 first (most popular and performant)
            try {
                const Database = require('better-sqlite3');
                this.db = new Database(path === ':memory:' ? ':memory:' : path);
                return;
            } catch (e) {
                lastError = e;
                console.log('better-sqlite3 error:', e);
                // Fall back to sqlite3
                const sqlite3 = require('sqlite3');
                this.db = new sqlite3.Database(path);
                return;
            }
        } catch (error) {
            console.log('All SQLite drivers failed. Last error:', lastError);
            throw new Error(
                'SQLite driver not found. Install one of:\n' +
                    '  npm install better-sqlite3  (recommended)\n' +
                    '  npm install sqlite3\n' +
                    'Or use libsql with: npm install @libsql/client\n' +
                    'Last error: ' +
                    (lastError ? lastError.message : String(error))
            );
        }
    }

    // Default async methods
    async exec(sql: string, params: any[] = []): Promise<void> {
        if (this.isClosed) {
            return; // Silently ignore operations on closed database
        }
        try {
            if (this.dbType === 'libsql') {
                // LibSQL native async support
                await this.db.execute({ sql, args: params });
            } else {
                // Make sync operations async for consistency
                await new Promise((resolve) => setImmediate(resolve));
                // Check again after async operation
                if (this.isClosed) {
                    return;
                }
                if (this.db.prepare) {
                    // better-sqlite3
                    const stmt = this.db.prepare(sql);
                    stmt.run(params);
                } else {
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            // Ignore closed database errors
            if (
                error instanceof Error &&
                error.message.includes('closed database')
            ) {
                return;
            }
            throw new DatabaseError(
                `Failed to execute: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                sql
            );
        }
    }

    async query(sql: string, params: any[] = []): Promise<Row[]> {
        if (this.isClosed) {
            return []; // Return empty array for closed database
        }
        try {
            if (this.dbType === 'libsql') {
                // LibSQL native async support
                const result = await this.db.execute({ sql, args: params });
                return result.rows.map((row: any) =>
                    this.convertLibSQLRow(row, result.columns)
                );
            } else {
                // Make sync operations async for consistency
                await new Promise((resolve) => setImmediate(resolve));
                // Check again after async operation
                if (this.isClosed) {
                    return [];
                }
                if (this.db.prepare) {
                    // better-sqlite3
                    const stmt = this.db.prepare(sql);
                    return stmt.all(params);
                } else {
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            // Ignore closed database errors
            if (
                error instanceof Error &&
                error.message.includes('closed database')
            ) {
                return [];
            }
            throw new DatabaseError(
                `Failed to query: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                sql
            );
        }
    }

    // Sync methods for backward compatibility
    execSync(sql: string, params: any[] = []): void {
        if (this.isClosed) {
            return; // Silently ignore operations on closed database
        }
        try {
            if (this.dbType === 'libsql') {
                // Check if LibSQL supports sync operations
                if (this.db.executeSync) {
                    this.db.executeSync({ sql, args: params });
                } else {
                    // Fallback for LibSQL versions without sync support
                    console.warn(
                        'LibSQL sync operations not supported, falling back to async with blocking'
                    );
                    // This is not ideal but provides compatibility
                    let error: any = null;
                    let completed = false;
                    this.exec(sql, params)
                        .then(() => (completed = true))
                        .catch((e) => (error = e));
                    // Simple blocking wait - not recommended for production
                    while (!completed && !error) {
                        // Busy wait - should be replaced with proper sync implementation
                    }
                    if (error) throw error;
                }
            } else {
                // Handle different SQLite drivers
                if (this.db.prepare) {
                    // better-sqlite3
                    const stmt = this.db.prepare(sql);
                    stmt.run(params);
                } else {
                    // sqlite3 (callback-based, not ideal for sync interface)
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            // Ignore closed database errors
            if (
                error instanceof Error &&
                error.message.includes('closed database')
            ) {
                return;
            }
            throw new DatabaseError(
                `Failed to execute: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                sql
            );
        }
    }

    querySync(sql: string, params: any[] = []): Row[] {
        if (this.isClosed) {
            return []; // Return empty array for closed database
        }
        try {
            if (this.dbType === 'libsql') {
                // Check if LibSQL supports sync operations
                if (this.db.executeSync) {
                    const result = this.db.executeSync({ sql, args: params });
                    return result.rows.map((row: any) =>
                        this.convertLibSQLRow(row, result.columns)
                    );
                } else {
                    // Fallback for LibSQL versions without sync support
                    console.warn(
                        'LibSQL sync operations not supported, falling back to async with blocking'
                    );
                    // This is not ideal but provides compatibility
                    let result: Row[] = [];
                    let error: any = null;
                    this.query(sql, params)
                        .then((r) => (result = r))
                        .catch((e) => (error = e));
                    // Simple blocking wait - not recommended for production
                    while (result.length === 0 && !error) {
                        // Busy wait - should be replaced with proper sync implementation
                    }
                    if (error) throw error;
                    return result;
                }
            } else {
                // Handle different SQLite drivers
                if (this.db.prepare) {
                    // better-sqlite3
                    const stmt = this.db.prepare(sql);
                    return stmt.all(params);
                } else {
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            // Ignore closed database errors
            if (
                error instanceof Error &&
                error.message.includes('closed database')
            ) {
                return [];
            }
            throw new DatabaseError(
                `Failed to query: ${
                    error instanceof Error ? error.message : String(error)
                }`,
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
        if (this.isClosed) {
            throw new DatabaseError(
                'Cannot start transaction on closed database'
            );
        }

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
                // better-sqlite3 synchronous transaction - wrap properly
                try {
                    const transaction = this.db.transaction(async () => {
                        return await fn();
                    });
                    return await transaction();
                } catch (error) {
                    throw error;
                }
            } else {
                // Fallback transaction implementation
                await this.exec('BEGIN TRANSACTION');
                try {
                    const result = await fn();
                    await this.exec('COMMIT');
                    return result;
                } catch (error) {
                    try {
                        await this.exec('ROLLBACK');
                    } catch (rollbackError) {
                        // Ignore rollback errors
                    }
                    throw error;
                }
            }
        }
    }

    async close(): Promise<void> {
        if (this.isClosed) return;
        // Use setImmediate to make it truly async
        await new Promise((resolve) => setImmediate(resolve));
        this.isClosed = true;
        try {
            if (this.db) {
                if (this.dbType === 'libsql') {
                    if (this.db.close) {
                        await this.db.close();
                    }
                } else {
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

    closeSync(): void {
        if (this.isClosed) return;
        this.isClosed = true;
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
