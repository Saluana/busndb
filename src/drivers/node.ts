import type { Row, DBConfig } from '../types';
import { DatabaseError } from '../errors';
import { createRequire } from 'module';
import { BaseDriver } from './base.js';

// Create require function for ES modules
const require = createRequire(import.meta.url);

export class NodeDriver extends BaseDriver {
    private db: any;
    private dbType: 'sqlite' | 'libsql' = 'sqlite';

    constructor(config: DBConfig = {}) {
        super(config);
        this.initializeDriver(config);
    }

    protected initializeDriver(config: DBConfig): void {
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

    async exec(sql: string, params: any[] = []): Promise<void> {
        if (this.isClosed) {
            return;
        }
        try {
            if (this.dbType === 'libsql') {
                await this.db.execute({ sql, args: params });
            } else {
                if (this.isClosed) {
                    throw new DatabaseError('Database is closed');
                }
                if (this.db.prepare) {
                    const stmt = this.db.prepare(sql);
                    stmt.run(params);
                } else {
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
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
            return [];
        }
        try {
            if (this.dbType === 'libsql') {
                const result = await this.db.execute({ sql, args: params });
                return result.rows.map((row: any) =>
                    this.convertLibSQLRow(row, result.columns)
                );
            } else {
                if (this.isClosed) {
                    throw new DatabaseError('Database is closed');
                }
                if (this.db.prepare) {
                    const stmt = this.db.prepare(sql);
                    return stmt.all(params);
                } else {
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
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

    execSync(sql: string, params: any[] = []): void {
        if (this.isClosed) {
            return;
        }
        try {
            if (this.dbType === 'libsql') {
                if (this.db.executeSync) {
                    this.db.executeSync({ sql, args: params });
                } else {
                    throw new DatabaseError(
                        'LibSQL sync operations not available. Use async methods (exec) or switch to better-sqlite3 for sync support.',
                        sql
                    );
                }
            } else {
                if (this.db.prepare) {
                    const stmt = this.db.prepare(sql);
                    stmt.run(params);
                } else {
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
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
            return [];
        }
        try {
            if (this.dbType === 'libsql') {
                if (this.db.executeSync) {
                    const result = this.db.executeSync({ sql, args: params });
                    return result.rows.map((row: any) =>
                        this.convertLibSQLRow(row, result.columns)
                    );
                } else {
                    throw new DatabaseError(
                        'LibSQL sync operations not available. Use async methods (query) or switch to better-sqlite3 for sync support.',
                        sql
                    );
                }
            } else {
                if (this.db.prepare) {
                    const stmt = this.db.prepare(sql);
                    return stmt.all(params);
                } else {
                    throw new Error(
                        'sqlite3 driver requires async operations. Use better-sqlite3 for sync interface.'
                    );
                }
            }
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
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
            if (this.db.transaction) {
                try {
                    const transaction = this.db.transaction(async () => {
                        return await fn();
                    });
                    return await transaction();
                } catch (error) {
                    throw error;
                }
            } else {
                return await super.transaction(fn);
            }
        }
    }

    protected async closeDatabase(): Promise<void> {
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
            console.warn('Warning: Error closing database connection:', error);
        }
    }

    protected closeDatabaseSync(): void {
        try {
            if (this.db) {
                if (this.db.close) {
                    this.db.close();
                }
            }
        } catch (error) {
            console.warn('Warning: Error closing database connection:', error);
        }
    }
}

// Export a factory function for easier testing and configuration
export function createNodeDriver(config: DBConfig = {}): NodeDriver {
    return new NodeDriver(config);
}
