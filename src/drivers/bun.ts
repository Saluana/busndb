import { Database } from 'bun:sqlite';
import type { Driver, Row, DBConfig } from '../types.js';
import { DatabaseError } from '../errors.js';

export class BunDriver implements Driver {
  private db: Database;

  constructor(config: DBConfig) {
    try {
      this.db = new Database(config.memory ? ':memory:' : config.path || 'database.db');
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
    const tx = this.db.transaction(async () => {
      return await fn();
    });
    return tx();
  }

  close(): void {
    this.db.close();
  }
}