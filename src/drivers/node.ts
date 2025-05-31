import type { Row, DBConfig } from '../types';
import { DatabaseError } from '../errors';
import { createRequire } from 'module';
import { BaseDriver } from './base.js';
import { LibSQLConnectionPool, createLibSQLPool } from '../libsql-pool.js';

// Create require function for ES modules
const require = createRequire(import.meta.url);

export class NodeDriver extends BaseDriver {
    private db?: any;
    private dbType: 'sqlite' | 'libsql' = 'sqlite';
    private libsqlPool?: LibSQLConnectionPool;
    private currentConnection?: any;

    constructor(config: DBConfig = {}) {
        super(config);
        // Initialize the driver if not using shared connections
        if (!config.sharedConnection) {
            this.initializeDriverSync(config);
        }
    }

    protected async initializeDriver(config: DBConfig): Promise<void> {
        await this.initializeDatabase(config);
    }

    private initializeDriverSync(config: DBConfig): void {
        try {
            const path = config.path || ':memory:';

            // For sync initialization, prefer better-sqlite3 since it supports sync operations
            // LibSQL requires async initialization
            const isLocalFile =
                path === ':memory:' ||
                (!path.startsWith('http://') &&
                    !path.startsWith('https://') &&
                    !path.startsWith('libsql://') &&
                    !(config as any).authToken &&
                    !(config as any).libsql);

            if (isLocalFile) {
                this.initializeSQLite(path);
                this.dbType = 'sqlite';
                this.configureSQLite(config);
            } else {
                // For remote connections or LibSQL, defer to async initialization
                // This case should be handled by ensureConnection() which calls async initializeDriver
                return;
            }

            this.connectionState = {
                isConnected: true,
                isHealthy: true,
                lastHealthCheck: Date.now(),
                connectionAttempts: 0,
            };
        } catch (error) {
            this.connectionState = {
                isConnected: false,
                isHealthy: false,
                lastHealthCheck: Date.now(),
                connectionAttempts: 1,
                lastError:
                    error instanceof Error ? error : new Error(String(error)),
            };
            throw error;
        }
    }

    private async initializeDatabase(config: DBConfig): Promise<void> {
        try {
            const path = config.path || ':memory:';

            // Check if we should use LibSQL pooling for remote connections
            const isRemoteLibSQL =
                path.startsWith('http://') ||
                path.startsWith('https://') ||
                path.startsWith('libsql://') ||
                config.authToken;

            if (isRemoteLibSQL && config.libsqlPool) {
                // Use LibSQL connection pool for remote connections
                this.libsqlPool = createLibSQLPool(config, config.libsqlPool);
                this.dbType = 'libsql';

                this.connectionState = {
                    isConnected: true,
                    isHealthy: true,
                    lastHealthCheck: Date.now(),
                    connectionAttempts: 0,
                };
                return;
            }

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
                } catch (sqliteError) {
                    // If better-sqlite3 fails, try LibSQL as fallback
                    try {
                        await this.initializeLibSQL(config, path);
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
                    await this.initializeLibSQL(config, path);
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

            this.connectionState = {
                isConnected: true,
                isHealthy: true,
                lastHealthCheck: Date.now(),
                connectionAttempts: 0,
            };
        } catch (error) {
            this.connectionState = {
                isConnected: false,
                isHealthy: false,
                lastHealthCheck: Date.now(),
                connectionAttempts: this.connectionState.connectionAttempts + 1,
                lastError:
                    error instanceof Error ? error : new Error(String(error)),
            };
            throw error;
        }
    }

    private async initializeLibSQL(
        config: DBConfig,
        path: string
    ): Promise<void> {
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

    private ensureInitialized(): void {
        if (!this.db && !this.libsqlPool && !this.isClosed) {
            // Try sync initialization for local SQLite files
            this.initializeDriverSync(this.config);
        }
    }

    async exec(sql: string, params: any[] = []): Promise<void> {
        if (this.isClosed) {
            return;
        }
        this.ensureInitialized();
        await this.ensureConnection();

        try {
            if (this.libsqlPool) {
                // Use connection pool
                const connection = await this.libsqlPool.acquire();
                try {
                    await connection.client.execute({ sql, args: params });
                } finally {
                    await this.libsqlPool.release(connection);
                }
            } else if (this.dbType === 'libsql') {
                if (!this.db || this.isClosed) {
                    // Silently return if database is closed/closing
                    return;
                }
                await this.db.execute({ sql, args: params });
            } else {
                if (!this.db || this.isClosed) {
                    // Silently return if database is closed/closing
                    return;
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
                this.connectionState.isConnected = false;
                this.connectionState.isHealthy = false;
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
        this.ensureInitialized();
        await this.ensureConnection();

        try {
            if (this.libsqlPool) {
                // Use connection pool
                const connection = await this.libsqlPool.acquire();
                try {
                    const result = await connection.client.execute({
                        sql,
                        args: params,
                    });
                    return result.rows.map((row: any) =>
                        this.convertLibSQLRow(row, result.columns)
                    );
                } finally {
                    await this.libsqlPool.release(connection);
                }
            } else if (this.dbType === 'libsql') {
                if (!this.db || this.isClosed) {
                    // Silently return empty results if database is closed/closing
                    return [];
                }
                const result = await this.db.execute({ sql, args: params });
                return result.rows.map((row: any) =>
                    this.convertLibSQLRow(row, result.columns)
                );
            } else {
                if (!this.db || this.isClosed) {
                    // Silently return empty results if database is closed/closing
                    return [];
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
                this.connectionState.isConnected = false;
                this.connectionState.isHealthy = false;
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
        this.ensureInitialized();
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
        this.ensureInitialized();
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

    protected async performHealthCheck(): Promise<void> {
        this.ensureInitialized();
        if (this.libsqlPool) {
            // Test pool health by acquiring and releasing a connection
            const connection = await this.libsqlPool.acquire();
            try {
                await connection.client.execute({ sql: 'SELECT 1', args: [] });
            } finally {
                await this.libsqlPool.release(connection);
            }
        } else if (this.dbType === 'libsql') {
            if (!this.db) {
                throw new DatabaseError(
                    'Database not initialized',
                    'DB_NOT_INITIALIZED'
                );
            }
            await this.db.execute({ sql: 'SELECT 1', args: [] });
        } else {
            if (!this.db) {
                throw new DatabaseError(
                    'Database not initialized',
                    'DB_NOT_INITIALIZED'
                );
            }
            if (this.db.prepare) {
                const stmt = this.db.prepare('SELECT 1');
                stmt.get();
            } else {
                throw new Error(
                    'Cannot perform health check on sqlite3 driver'
                );
            }
        }
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
            if (this.libsqlPool) {
                await this.libsqlPool.close();
                this.libsqlPool = undefined;
            } else if (this.db) {
                if (this.dbType === 'libsql') {
                    if (this.db.close) {
                        await this.db.close();
                    }
                } else {
                    if (this.db.close) {
                        this.db.close();
                    }
                }
                this.db = undefined;
            }

            this.connectionState.isConnected = false;
            this.connectionState.isHealthy = false;
        } catch (error) {
            console.warn('Warning: Error closing database connection:', error);
        }
    }

    protected closeDatabaseSync(): void {
        try {
            if (this.libsqlPool) {
                // Cannot close pool synchronously, just mark as closed
                console.warn('Warning: Cannot close LibSQL pool synchronously');
                this.libsqlPool = undefined;
            } else if (this.db) {
                if (this.dbType === 'libsql') {
                    if (this.db.closeSync) {
                        this.db.closeSync();
                    } else if (this.db.close) {
                        this.db.close();
                        console.warn("Warning: Called a potentially asynchronous close() method on a LibSQL non-pooled connection during closeDatabaseSync. Full synchronous cleanup cannot be guaranteed. Consider using the asynchronous close() method for LibSQL connections.");
                    }
                } else {
                    // For other dbTypes like 'sqlite'
                    if (this.db.close) {
                        this.db.close();
                    }
                }
                this.db = undefined;
            }

            this.connectionState.isConnected = false;
            this.connectionState.isHealthy = false;
        } catch (error) {
            console.warn('Warning: Error closing database connection:', error);
        }
    }
}

// Export a factory function for easier testing and configuration
export function createNodeDriver(config: DBConfig = {}): NodeDriver {
    return new NodeDriver(config);
}
