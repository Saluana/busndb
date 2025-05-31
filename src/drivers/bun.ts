import { Database } from 'bun:sqlite';
import type { Row, DBConfig } from '../types.js';
import { DatabaseError } from '../errors.js';
import { BaseDriver } from './base.js';

export class BunDriver extends BaseDriver {
    private db?: Database;

    constructor(config: DBConfig) {
        super(config);
        // Lazy initialization - only connect when needed
        if (!config.sharedConnection) {
            this.initializeDriverSync(config);
        }
    }

    protected async initializeDriver(config: DBConfig): Promise<void> {
        this.initializeDriverSync(config);
    }

    private initializeDriverSync(config: DBConfig): void {
        try {
            this.db = new Database(
                config.memory ? ':memory:' : config.path || 'database.db'
            );
            this.configureSQLite(config);

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
            throw new DatabaseError(`Failed to initialize database: ${error}`);
        }
    }

    private ensureInitialized(): void {
        if (!this.db) {
            this.initializeDriverSync(this.config);
        }
    }

    protected async performHealthCheck(): Promise<void> {
        this.ensureInitialized();
        if (!this.db) {
            throw new DatabaseError(
                'Database not initialized',
                'DB_NOT_INITIALIZED'
            );
        }

        try {
            const stmt = this.db.prepare('SELECT 1');
            stmt.get();
        } catch (error) {
            throw new DatabaseError(
                `Health check failed: ${error}`,
                'HEALTH_CHECK_FAILED'
            );
        }
    }

    async exec(sql: string, params: any[] = []): Promise<void> {
        if (this.isClosed) {
            return;
        }
        this.ensureInitialized();
        await this.ensureConnection();

        try {
            if (!this.db || this.isClosed) {
                // Silently return if database is closed/closing
                return;
            }
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                this.connectionState.isConnected = false;
                this.connectionState.isHealthy = false;
                return;
            }
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    protected async _query(sql: string, params: any[] = []): Promise<Row[]> {
        if (this.isClosed) {
            return [];
        }
        this.ensureInitialized();
        await this.ensureConnection();

        try {
            if (!this.db || this.isClosed) {
                // Silently return empty results if database is closed/closing
                return [];
            }
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                this.connectionState.isConnected = false;
                this.connectionState.isHealthy = false;
                return [];
            }
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    execSync(sql: string, params: any[] = []): void {
        if (this.isClosed) {
            return;
        }
        this.ensureInitialized();

        try {
            if (!this.db || this.isClosed) {
                // Silently return if database is closed/closing
                return;
            }
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                this.connectionState.isConnected = false;
                this.connectionState.isHealthy = false;
                return;
            }
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    protected _querySync(sql: string, params: any[] = []): Row[] {
        if (this.isClosed) {
            return [];
        }
        this.ensureInitialized();

        try {
            if (!this.db || this.isClosed) {
                // Silently return empty results if database is closed/closing
                return [];
            }
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                this.connectionState.isConnected = false;
                this.connectionState.isHealthy = false;
                return [];
            }
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    protected async closeDatabase(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = undefined;
        }
        this.connectionState.isConnected = false;
        this.connectionState.isHealthy = false;
    }

    protected closeDatabaseSync(): void {
        if (this.db) {
            this.db.close();
            this.db = undefined;
        }
        this.connectionState.isConnected = false;
        this.connectionState.isHealthy = false;
    }
}
