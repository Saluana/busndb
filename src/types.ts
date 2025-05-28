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
}

export interface Driver {
    exec(sql: string, params?: any[]): void;
    query(sql: string, params?: any[]): Row[];
    transaction<T>(fn: () => Promise<T>): Promise<T>;
    close(): void;
}

export interface Row {
    [key: string]: any;
}

export interface CollectionSchema<T = any> {
    name: string;
    schema: z.ZodSchema<T>;
    primaryKey: string;
    indexes?: string[];
    constraints?: SchemaConstraints;
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
