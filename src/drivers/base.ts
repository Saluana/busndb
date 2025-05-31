import * as os from 'os';
import type { Driver, Row, DBConfig } from '../types.js';
import { DatabaseError } from '../errors.js';

export interface ConnectionState {
    isConnected: boolean;
    isHealthy: boolean;
    lastHealthCheck: number;
    connectionAttempts: number;
    lastError?: Error;
}

export abstract class BaseDriver implements Driver {
    protected isClosed = false;
    protected isInTransaction = false;
    protected queryCount: number = 0;
    protected connectionState: ConnectionState = {
        isConnected: false,
        isHealthy: false,
        lastHealthCheck: 0,
        connectionAttempts: 0,
    };
    protected config: DBConfig;
    protected autoReconnect: boolean;
    protected maxReconnectAttempts: number;
    protected reconnectDelay: number;

    constructor(config: DBConfig) {
        this.config = config;
        this.autoReconnect = config.autoReconnect ?? true;
        this.maxReconnectAttempts = config.maxReconnectAttempts ?? 3;
        this.reconnectDelay = config.reconnectDelay ?? 1000;
        // Child classes must call this.initializeDriver(config) after their setup
    }

    protected abstract initializeDriver(config: DBConfig): Promise<void> | void;

    protected async ensureConnection(): Promise<void> {
        if (this.isClosed) {
            throw new DatabaseError('Driver is closed', 'DRIVER_CLOSED');
        }

        if (!this.connectionState.isConnected) {
            await this.reconnect();
        } else if (!this.connectionState.isHealthy) {
            const shouldReconnect = await this.checkHealth();
            if (!shouldReconnect && this.autoReconnect) {
                await this.reconnect();
            }
        }
    }

    protected async reconnect(): Promise<void> {
        if (this.connectionState.connectionAttempts >= this.maxReconnectAttempts) {
            throw new DatabaseError(
                `Max reconnection attempts (${this.maxReconnectAttempts}) exceeded`,
                'MAX_RECONNECT_ATTEMPTS'
            );
        }

        try {
            await this.closeDatabase();
            await this.delay(this.reconnectDelay * (this.connectionState.connectionAttempts + 1));
            
            await this.initializeDriver(this.config);
            
            this.connectionState = {
                isConnected: true,
                isHealthy: true,
                lastHealthCheck: Date.now(),
                connectionAttempts: 0,
            };
        } catch (error) {
            this.connectionState.connectionAttempts++;
            this.connectionState.lastError = error instanceof Error ? error : new Error(String(error));
            throw error;
        }
    }

    protected async checkHealth(): Promise<boolean> {
        try {
            await this.performHealthCheck();
            this.connectionState.isHealthy = true;
            this.connectionState.lastHealthCheck = Date.now();
            return true;
        } catch (error) {
            this.connectionState.isHealthy = false;
            this.connectionState.lastError = error instanceof Error ? error : new Error(String(error));
            return false;
        }
    }

    protected async performHealthCheck(): Promise<void> {
        // Simple health check - override in child classes for driver-specific checks
        await this.query('SELECT 1');
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    getConnectionState(): ConnectionState {
        return { ...this.connectionState };
    }

    protected configureSQLite(config: DBConfig): void {
        const MIN_CACHE_KIB = -16000; // 16MB
        const MAX_CACHE_KIB = -256000; // 256MB
        const MB_IN_BYTES = 1024 * 1024;
        const KIB_IN_BYTES = 1024;

        let calculatedCacheKiB: number;

        try {
            const freeMemoryBytes = os.freemem();
            const freeMemoryMB = freeMemoryBytes / MB_IN_BYTES;

            // Handle low memory: if 10% of free memory is less than 16MB, default to min cache.
            // 16MB is 16 * 1024 * 1024 bytes. 10% of this is 1.6MB.
            // So if freeMemoryBytes * 0.1 < 16 * MB_IN_BYTES (i.e. freeMemoryBytes < 160 * MB_IN_BYTES)
            if (freeMemoryBytes < 160 * MB_IN_BYTES) {
                calculatedCacheKiB = MIN_CACHE_KIB;
            } else {
                let baseCacheBytes = freeMemoryBytes * 0.10; // 10% of free memory

                if (this.queryCount < 100) {
                    baseCacheBytes *= 0.50; // 50% of base for low query count
                } else if (this.queryCount >= 1000) {
                    baseCacheBytes *= 1.50; // 150% of base for high query count
                }
                // For 100 <= queryCount < 1000, it's 100% of base, so no change.

                // Convert to KiB for PRAGMA, ensure it's an integer, and make it negative
                let cacheKiB = Math.floor(baseCacheBytes / KIB_IN_BYTES);

                // Clamp the value within defined min/max bounds
                // Note: Since values are negative, Math.max is used for lower bound (less negative)
                // and Math.min for upper bound (more negative).
                calculatedCacheKiB = Math.max(MAX_CACHE_KIB, Math.min(MIN_CACHE_KIB, -cacheKiB));
            }
        } catch (error) {
            console.warn('Warning: Failed to calculate dynamic cache size, defaulting to MIN_CACHE_KIB. Error:', error);
            calculatedCacheKiB = MIN_CACHE_KIB;
        }

        const sqliteConfig = {
            journalMode: 'WAL',
            synchronous: 'NORMAL',
            busyTimeout: 5000,
            cacheSize: calculatedCacheKiB,
            tempStore: 'MEMORY',
            lockingMode: 'NORMAL',
            autoVacuum: 'NONE',
            walCheckpoint: 1000,
            ...config.sqlite,
            cacheSize: calculatedCacheKiB, // Ensure our calculated value overrides any default from config.sqlite
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

        await this.ensureConnection();
        
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
                    this.connectionState.isConnected = false;
                    this.connectionState.isHealthy = false;
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
    protected abstract _query(sql: string, params?: any[]): Promise<Row[]>;
    abstract execSync(sql: string, params?: any[]): void;
    protected abstract _querySync(sql: string, params?: any[]): Row[];

    public async query(sql: string, params?: any[]): Promise<Row[]> {
        this.queryCount++;
        return this._query(sql, params);
    }

    public querySync(sql: string, params?: any[]): Row[] {
        this.queryCount++;
        return this._querySync(sql, params);
    }
}
