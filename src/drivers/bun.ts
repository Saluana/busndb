import { Database } from 'bun:sqlite';
import type { Row, DBConfig } from '../types.js';
import { DatabaseError } from '../errors.js';
import { BaseDriver } from './base.js';

export class BunDriver extends BaseDriver {
    private db!: Database;

    constructor(config: DBConfig) {
        super(config);
        this.initializeDriver(config);
    }

    protected initializeDriver(config: DBConfig): void {
        try {
            this.db = new Database(
                config.memory ? ':memory:' : config.path || 'database.db'
            );
            this.configureSQLite(config);
        } catch (error) {
            throw new DatabaseError(`Failed to initialize database: ${error}`);
        }
    }

    async exec(sql: string, params: any[] = []): Promise<void> {
        if (this.isClosed) {
            return;
        }
        try {
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                return;
            }
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    async query(sql: string, params: any[] = []): Promise<Row[]> {
        if (this.isClosed) {
            return [];
        }
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                return [];
            }
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    execSync(sql: string, params: any[] = []): void {
        if (this.isClosed) {
            return;
        }
        try {
            const stmt = this.db.prepare(sql);
            stmt.run(...params);
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                return;
            }
            throw new DatabaseError(`Failed to execute: ${error}`);
        }
    }

    querySync(sql: string, params: any[] = []): Row[] {
        if (this.isClosed) {
            return [];
        }
        try {
            const stmt = this.db.prepare(sql);
            return stmt.all(...params) as Row[];
        } catch (error) {
            if (this.handleClosedDatabase(error)) {
                return [];
            }
            throw new DatabaseError(`Failed to query: ${error}`);
        }
    }

    protected async closeDatabase(): Promise<void> {
        this.db.close();
    }

    protected closeDatabaseSync(): void {
        this.db.close();
    }
}
