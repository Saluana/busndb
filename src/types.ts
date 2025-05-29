import { z } from 'zod';
import type { SchemaConstraints } from './schema-constraints';

export interface DBConfig {
    path?: string;
    memory?: boolean;
    driver?: 'bun' | 'node';
    // LibSQL-specific options
    authToken?: string;
    syncUrl?: string;
    libsql?: boolean;
    // SQLite optimization options
    sqlite?: {
        journalMode?: 'DELETE' | 'TRUNCATE' | 'PERSIST' | 'MEMORY' | 'WAL';
        synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
        busyTimeout?: number; // milliseconds
        cacheSize?: number; // pages (negative = KB)
        tempStore?: 'DEFAULT' | 'FILE' | 'MEMORY';
        lockingMode?: 'NORMAL' | 'EXCLUSIVE';
        autoVacuum?: 'NONE' | 'FULL' | 'INCREMENTAL';
        walCheckpoint?: number; // pages before auto-checkpoint
    };
}

export interface Driver {
    // Default async methods
    exec(sql: string, params?: any[]): Promise<void>;
    query(sql: string, params?: any[]): Promise<Row[]>;
    transaction<T>(fn: () => Promise<T>): Promise<T>;
    close(): Promise<void>;
    
    // Sync methods (for backward compatibility)
    execSync(sql: string, params?: any[]): void;
    querySync(sql: string, params?: any[]): Row[];
    closeSync(): void;
}

export interface Row {
    [key: string]: any;
}

export interface ConstrainedFieldDefinition {
    type?: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB';
    unique?: boolean;
    foreignKey?: string; // 'table.column'
    onDelete?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
    onUpdate?: 'CASCADE' | 'SET NULL' | 'RESTRICT';
    nullable?: boolean;
    checkConstraint?: string;
}

export interface CollectionSchema<T = any> {
    name: string;
    schema: z.ZodSchema<T>;
    primaryKey: string;
    indexes?: string[];
    constraints?: SchemaConstraints;
    constrainedFields?: { [fieldPath: string]: ConstrainedFieldDefinition };
}

export type InferSchema<T> = T extends z.ZodSchema<infer U> ? U : never;

export interface QueryFilter {
    field: string;
    operator:
        | 'eq'
        | 'neq'
        | 'gt'
        | 'gte'
        | 'lt'
        | 'lte'
        | 'in'
        | 'nin'
        | 'like'
        | 'ilike'
        | 'startswith'
        | 'endswith'
        | 'contains'
        | 'exists'
        | 'between';
    value: any;
    value2?: any; // For between operator
}

export interface QueryGroup {
    type: 'and' | 'or';
    filters: (QueryFilter | QueryGroup)[];
}

export interface QueryOptions {
    filters: (QueryFilter | QueryGroup)[];
    orderBy?: { field: string; direction: 'asc' | 'desc' }[];
    limit?: number;
    offset?: number;
    groupBy?: string[];
    distinct?: boolean;
}
